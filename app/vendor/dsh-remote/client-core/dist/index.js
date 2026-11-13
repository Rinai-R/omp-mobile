import { createRpcRequest, decodeMessage, encodeMessage, } from '@dsh-remote/protocol';
export class RemoteClientError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        this.name = 'RemoteClientError';
    }
}
export class RemoteClientCore {
    transport;
    timeoutMs;
    pending = new Map();
    eventHandlers = new Set();
    unsubscribeTransport;
    unsubscribeClose;
    closeHandlers = new Set();
    closeNotified = false;
    // Keep the first close reason so late stream cleanup fails without a new timer.
    terminalCode;
    constructor(transport, timeoutMs = 30_000) {
        this.transport = transport;
        this.timeoutMs = timeoutMs;
    }
    async connect() {
        if (this.terminalCode !== undefined)
            throw new RemoteClientError(this.terminalCode, 'The remote client has closed.');
        if (this.unsubscribeTransport !== undefined)
            return;
        this.closeNotified = false;
        this.unsubscribeTransport = this.transport.onMessage(data => this.handleMessage(data));
        this.unsubscribeClose = this.transport.onClose?.(error => this.handleTransportClose(error));
        try {
            await this.transport.connect();
        }
        catch (error) {
            this.unsubscribeTransport();
            this.unsubscribeTransport = undefined;
            this.unsubscribeClose?.();
            this.unsubscribeClose = undefined;
            throw error;
        }
    }
    async rpc(method, params, signal, options) {
        if (signal?.aborted)
            throw rpcAbortedError(method, signal.reason);
        if (this.terminalCode !== undefined) {
            throw new RemoteClientError(this.terminalCode, `RPC ${method} cannot start after the remote client closed`);
        }
        const timeoutMs = typeof options === 'number' ? options : callTimeoutMs(this.timeoutMs, options);
        const request = createRpcRequest(method, params);
        const result = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.rejectPending(request.id, new RemoteClientError('RPC_TIMEOUT', `RPC ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const pending = {
                method,
                resolve: resolve,
                reject,
                timer,
            };
            if (signal !== undefined) {
                const onAbort = () => {
                    if (this.pending.get(request.id) !== pending)
                        return;
                    this.rejectPending(request.id, rpcAbortedError(method, signal.reason));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                pending.removeAbort = () => signal.removeEventListener('abort', onAbort);
            }
            this.pending.set(request.id, pending);
        });
        // Do not await the write: timeout, abort, or close must be able to settle
        // the RPC even when the transport send itself never completes.
        try {
            const send = this.transport.send(encodeMessage(request));
            void send.catch(error => {
                this.rejectPending(request.id, transportSendError(error));
            });
        }
        catch (error) {
            this.rejectPending(request.id, transportSendError(error));
        }
        return result;
    }
    onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }
    onClose(handler) {
        this.closeHandlers.add(handler);
        return () => this.closeHandlers.delete(handler);
    }
    getStats() {
        return this.transport.getStats();
    }
    async close() {
        this.terminalCode ??= 'CLIENT_CLOSED';
        this.unsubscribeTransport?.();
        this.unsubscribeTransport = undefined;
        this.unsubscribeClose?.();
        this.unsubscribeClose = undefined;
        this.rejectAllPending(pending => new RemoteClientError('CLIENT_CLOSED', `RPC ${pending.method} terminated because the remote client closed`));
        this.notifyClose(new RemoteClientError('CLIENT_CLOSED', 'The remote client was closed.'));
        await this.transport.close();
    }
    handleTransportClose(error) {
        this.terminalCode ??= 'TRANSPORT_CLOSED';
        this.rejectAllPending(pending => new RemoteClientError('TRANSPORT_CLOSED', `RPC ${pending.method} terminated because the remote transport closed`));
        this.notifyClose(error);
    }
    handleMessage(data) {
        const message = decodeMessage(data);
        if (message.type === 'rpc.response')
            this.handleResponse(message);
        if (message.type === 'rpc.error')
            this.handleError(message);
        if (message.type === 'event') {
            const event = message.payload;
            for (const handler of this.eventHandlers)
                handler(event);
        }
    }
    handleResponse(message) {
        const pending = this.takePending(message.payload.requestId);
        if (pending === undefined)
            return;
        pending.resolve(message.payload.result);
    }
    handleError(message) {
        const pending = this.takePending(message.payload.requestId);
        if (pending === undefined)
            return;
        pending.reject(Object.assign(new Error(message.payload.message), { code: message.payload.code }));
    }
    takePending(requestId) {
        const pending = this.pending.get(requestId);
        if (pending === undefined)
            return undefined;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.removeAbort?.();
        return pending;
    }
    rejectPending(requestId, error) {
        const pending = this.takePending(requestId);
        if (pending === undefined)
            return false;
        pending.reject(error);
        return true;
    }
    rejectAllPending(createError) {
        for (const requestId of [...this.pending.keys()]) {
            const pending = this.takePending(requestId);
            if (pending !== undefined)
                pending.reject(createError(pending));
        }
    }
    notifyClose(error) {
        if (this.closeNotified)
            return;
        this.closeNotified = true;
        for (const handler of this.closeHandlers)
            handler(error);
    }
}
function rpcAbortedError(method, reason) {
    return new RemoteClientError('RPC_ABORTED', `RPC ${method} was aborted`, reason === undefined ? undefined : { cause: reason });
}
function callTimeoutMs(fallback, options) {
    const timeoutMs = options?.timeoutMs;
    if (typeof timeoutMs !== 'number')
        return fallback;
    return Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647 ? timeoutMs : fallback;
}
function transportSendError(error) {
    return error instanceof Error
        ? error
        : new Error('remote transport send failed', { cause: error });
}
export * from './remote-gateway.js';
export * from './harness-alpha-client.js';
export * from './codex-client.js';
export * from './acp-client.js';
