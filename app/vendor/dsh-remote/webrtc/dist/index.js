import { waitForRelayCapacity } from './websocket-backpressure.js';
import { PROTOCOL_VERSION, acceptNegotiatedCapabilities, createControlFrame, createRelayDataFrame, decodeControlFrame, decodeRelayDataFrame, encodeControlFrame, encodeRelayDataFrame, } from '@dsh-remote/protocol';
import { BaseTransport } from './transport.js';
import { fromBase64Url, toBase64Url } from './util.js';
export * from './transport.js';
export * from './rtc-adapter.js';
export * from './rtc-chunking.js';
export * from './rtc-data-channel.js';
export * from './adaptive-transport.js';
export class RelayTransport extends BaseTransport {
    url;
    options;
    handshakeHandlers = new Set();
    socket;
    dataSocket;
    bytesSent = 0;
    bytesReceived = 0;
    connectionId;
    relayCounter = 0;
    readyResolve;
    readyReject;
    handshakeTimer;
    controlFrameLimits = {};
    dataReadyResolve;
    dataReadyReject;
    dataReady = false;
    constructor(url, options) {
        super();
        this.url = url;
        this.options = options;
    }
    async connect() {
        if (this.socket !== undefined)
            return;
        this.socket = new WebSocket(this.url);
        this.controlFrameLimits = {};
        this.socket.binaryType = 'arraybuffer';
        await new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
            this.handshakeTimer = setTimeout(() => this.failConnection(new Error('Relay control handshake timed out')), this.options.handshakeTimeoutMs ?? 10_000);
            const socket = this.socket;
            socket.onmessage = event => {
                void this.handleSocketMessage(event.data);
            };
            socket.onopen = () => {
                this.sendControl('hello', {
                    role: this.options.role,
                    deviceId: this.options.deviceId,
                    accessToken: this.options.accessToken,
                    protocols: [PROTOCOL_VERSION],
                    capabilities: this.options.capabilities ?? ['transport.relay', 'transport.relay.attach'],
                });
            };
            socket.onerror = () => this.failConnection(new Error(`RelayTransport failed to connect to ${this.url}`));
            socket.onclose = () => {
                const pending = this.readyReject !== undefined;
                if (pending)
                    this.failConnection(new Error('Relay control channel closed before it was ready'));
                this.socket = undefined;
                this.connectionId = undefined;
                this.emitClose();
            };
        });
    }
    async send(data) {
        const socket = this.dataSocket ?? this.socket;
        if (socket?.readyState !== WebSocket.OPEN)
            throw new Error('relay transport is not connected');
        if (this.connectionId === undefined)
            throw new Error('relay connection has not been authorized');
        await waitForRelayCapacity(socket);
        const payload = {
            connectionId: this.connectionId,
            targetDeviceId: this.options.targetDeviceId,
            counter: this.relayCounter,
            ciphertext: toBase64Url(data),
        };
        if (this.dataSocket !== undefined) {
            this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('relay', payload), this.controlFrameLimits));
        }
        else
            this.sendControl('relay', payload);
        this.bytesSent += data.byteLength;
        this.relayCounter += 1;
    }
    connectionInfo() {
        if (this.connectionId === undefined)
            throw new Error('relay connection has not been authorized');
        return {
            connectionId: this.connectionId,
            localDeviceId: this.options.deviceId,
            remoteDeviceId: this.options.targetDeviceId,
        };
    }
    async sendHandshake(step, data) {
        if (this.socket?.readyState !== WebSocket.OPEN || this.connectionId === undefined) {
            throw new Error('relay connection has not been authorized');
        }
        this.sendControl('secure.handshake', {
            connectionId: this.connectionId,
            targetDeviceId: this.options.targetDeviceId,
            step,
            data: toBase64Url(data),
        });
    }
    onHandshake(cb) {
        this.handshakeHandlers.add(cb);
        return () => this.handshakeHandlers.delete(cb);
    }
    async close() {
        this.clearHandshake();
        this.dataSocket?.close();
        this.dataSocket = undefined;
        this.dataReady = false;
        this.socket?.close();
        this.socket = undefined;
        this.connectionId = undefined;
    }
    getStats() {
        return {
            mode: this.socket?.readyState === WebSocket.OPEN ? 'Relay' : 'Disconnected',
            connected: this.socket?.readyState === WebSocket.OPEN,
            bytesSent: this.bytesSent,
            bytesReceived: this.bytesReceived,
        };
    }
    async handleSocketMessage(raw) {
        try {
            if (typeof raw !== 'string')
                throw new Error('Relay control frames must be text JSON');
            const frame = decodeControlFrame(raw, this.controlFrameLimits);
            if (frame.type === 'hello.ack') {
                const payload = frame.payload;
                if (payload.protocol !== PROTOCOL_VERSION)
                    throw new Error('Server selected an unsupported protocol version');
                const offered = this.options.capabilities ?? ['transport.relay', 'transport.relay.attach'];
                const negotiated = acceptNegotiatedCapabilities(offered, payload.capabilities);
                this.controlFrameLimits = {
                    maxControlFrameBytes: payload.maxControlFrameBytes,
                    maxRelayFrameBytes: payload.maxRelayFrameBytes,
                };
                if (!negotiated.includes('transport.relay')) {
                    throw new Error('Server did not negotiate the required Relay capability');
                }
                this.sendControl('connect.request', {
                    hostDeviceId: this.options.targetDeviceId,
                    preferredTransports: ['relay'],
                });
                return;
            }
            if (frame.type === 'connect.accepted') {
                const payload = frame.payload;
                if (typeof payload.connectionId !== 'string' || payload.connectionId.length === 0) {
                    throw new Error('connect.accepted did not include a connectionId');
                }
                this.connectionId = payload.connectionId;
                const assignment = payload;
                if (typeof assignment.relayEndpoint === 'string' && typeof assignment.relayTicket === 'string') {
                    await this.openDataSocket(assignment);
                }
                this.finishConnection();
                return;
            }
            if (frame.type === 'connect.rejected' || frame.type === 'error') {
                const payload = frame.payload;
                const message = typeof payload.message === 'string' ? payload.message : 'Server rejected the relay connection';
                throw Object.assign(new Error(message), { code: payload.code });
            }
            if (frame.type === 'relay') {
                if (this.dataSocket !== undefined)
                    return;
                const payload = frame.payload;
                if (payload.connectionId !== this.connectionId
                    || payload.targetDeviceId !== this.options.deviceId
                    || !Number.isSafeInteger(payload.counter)
                    || typeof payload.ciphertext !== 'string') {
                    throw new Error('Received a relay frame for an unknown connection');
                }
                const data = fromBase64Url(payload.ciphertext);
                this.bytesReceived += data.byteLength;
                this.emit(data);
                return;
            }
            if (frame.type === 'secure.handshake') {
                const payload = frame.payload;
                if (payload.connectionId !== this.connectionId
                    || payload.targetDeviceId !== this.options.deviceId
                    || !Number.isSafeInteger(payload.step)
                    || typeof payload.data !== 'string') {
                    throw new Error('Received a secure handshake frame for an unknown connection');
                }
                const data = fromBase64Url(payload.data);
                for (const handler of this.handshakeHandlers)
                    handler(payload.step, data);
                return;
            }
            if (frame.type === 'ping')
                this.sendControl('pong', frame.payload);
        }
        catch (error) {
            this.failConnection(error instanceof Error ? error : new Error('Invalid relay control frame'));
        }
    }
    sendControl(type, payload) {
        if (this.socket?.readyState !== WebSocket.OPEN)
            throw new Error('relay control socket is not open');
        this.socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits));
    }
    async openDataSocket(assignment) {
        if (this.connectionId === undefined || this.dataSocket !== undefined)
            return;
        const socket = new WebSocket(assignment.relayEndpoint);
        socket.binaryType = 'arraybuffer';
        this.dataSocket = socket;
        await new Promise((resolve, reject) => {
            this.dataReadyResolve = resolve;
            this.dataReadyReject = reject;
            const timer = setTimeout(() => {
                this.dataReadyResolve = undefined;
                this.dataReadyReject = undefined;
                reject(new Error('Relay data attach timed out'));
                socket.close();
            }, this.options.handshakeTimeoutMs ?? 10_000);
            socket.onopen = () => {
                socket.send(encodeRelayDataFrame(createRelayDataFrame('relay.attach', {
                    connectionId: this.connectionId,
                    deviceId: this.options.deviceId,
                    peerDeviceId: this.options.targetDeviceId,
                    ticket: assignment.relayTicket,
                }), this.controlFrameLimits));
            };
            socket.onmessage = event => {
                try {
                    if (typeof event.data !== 'string')
                        throw new Error('Relay data frames must be text JSON');
                    const data = decodeRelayDataFrame(event.data, this.controlFrameLimits);
                    if (data.type === 'relay.ready') {
                        if (data.payload.connectionId !== this.connectionId
                            || (assignment.relayEpoch !== undefined && data.payload.epoch !== assignment.relayEpoch)) {
                            throw new Error('Relay data attach assignment mismatch');
                        }
                        clearTimeout(timer);
                        this.dataReady = true;
                        this.dataReadyResolve = undefined;
                        this.dataReadyReject = undefined;
                        resolve();
                        return;
                    }
                    void this.handleDataSocketFrame(data.type, data.payload).catch(error => {
                        this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'));
                    });
                }
                catch (error) {
                    clearTimeout(timer);
                    reject(error instanceof Error ? error : new Error('Invalid Relay data frame'));
                    this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'));
                }
            };
            socket.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Relay data socket failed'));
            };
            socket.onclose = () => {
                clearTimeout(timer);
                if (!this.dataReady)
                    reject(new Error('Relay data socket closed before attach'));
                else
                    this.failConnection(new Error('Relay data socket closed'));
            };
        });
    }
    async handleDataSocketFrame(type, payload) {
        if (type === 'relay.detach') {
            this.failConnection(new Error('Relay peer detached'));
            return;
        }
        if (type === 'ping') {
            if (this.dataSocket?.readyState === WebSocket.OPEN) {
                this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('pong', payload), this.controlFrameLimits));
            }
            return;
        }
        if (type === 'relay') {
            if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
                || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== 'string') {
                throw new Error('Received a relay frame for an unknown connection');
            }
            const data = fromBase64Url(payload.ciphertext);
            this.bytesReceived += data.byteLength;
            this.emit(data);
            return;
        }
        if (type === 'secure.handshake') {
            if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
                || !Number.isSafeInteger(payload.step) || typeof payload.data !== 'string') {
                throw new Error('Received a secure handshake frame for an unknown connection');
            }
            const data = fromBase64Url(payload.data);
            for (const handler of this.handshakeHandlers)
                handler(payload.step, data);
        }
    }
    finishConnection() {
        this.clearHandshake();
        this.readyResolve?.();
        this.readyResolve = undefined;
        this.readyReject = undefined;
    }
    failConnection(error) {
        this.clearHandshake();
        const reject = this.readyReject;
        this.readyResolve = undefined;
        this.readyReject = undefined;
        reject?.(error);
        const dataSocket = this.dataSocket;
        this.dataSocket = undefined;
        this.dataReady = false;
        this.dataReadyResolve = undefined;
        this.dataReadyReject = undefined;
        dataSocket?.close();
        this.socket?.close();
        this.socket = undefined;
        this.connectionId = undefined;
    }
    clearHandshake() {
        if (this.handshakeTimer !== undefined)
            clearTimeout(this.handshakeTimer);
        this.handshakeTimer = undefined;
    }
}
export { waitForRelayCapacity } from './websocket-backpressure.js';
export { SerialSend } from './serial-send.js';
export * from './control-lease.js';
