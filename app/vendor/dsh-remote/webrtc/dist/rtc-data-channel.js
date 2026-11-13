import { RTC_DATA_CHANNEL_LABEL, RTC_DATA_CHANNEL_OPTIONS, summarizeAddress, summarizeIceCandidate, } from './rtc-adapter.js';
import { RtcChunkCodec } from './rtc-chunking.js';
const DEFAULT_NEGOTIATE_TIMEOUT_MS = 8_000;
const SELECTED_PATH_RETRY_COUNT = 5;
const SELECTED_PATH_RETRY_DELAY_MS = 50;
/**
 * Complete WebRTC DataChannel transport state machine (webrtc plan §6.1).
 *
 * Owns one `RTCPeerConnection` + ordered `dsh` DataChannel for a single
 * connection establishment. It emits offer/answer/trickle-ICE via `onSignal`
 * and consumes the peer's signaling through `handleSignal`; the owner wires
 * those two ends to the Server control channel. `connect()` resolves only
 * once the DataChannel reaches `open`.
 */
export class RtcDataChannelTransport {
    pc;
    role;
    onSignal;
    negotiateTimeoutMs;
    channelLabel;
    sendTimeoutMs;
    label;
    onDiagnostic;
    channel;
    remoteCandidates = [];
    remoteDescriptionSet = false;
    opened = false;
    closed = false;
    messageHandlers = new Set();
    closeHandlers = new Set();
    errorHandlers = new Set();
    connectPromise;
    openResolve;
    openReject;
    negotiateTimer;
    removeAbort;
    watchdogTimer;
    outgoing = new RtcChunkCodec();
    incoming = new RtcChunkCodec();
    bytesSent = 0;
    bytesReceived = 0;
    selected;
    selectedMode;
    selectedRelayUrlValue;
    selectedPathTelemetry;
    localCandidateTelemetry = emptyCandidateTelemetry();
    remoteCandidateTelemetry = emptyCandidateTelemetry();
    candidatePairTelemetry = emptyCandidatePairTelemetry();
    filteredLocalCandidateTelemetry = emptyCandidateTelemetry();
    filteredCandidatePairTelemetry = emptyCandidateTelemetry();
    lastBufferedAmount = 0;
    constructor(options) {
        this.role = options.role;
        this.onSignal = options.onSignal;
        this.negotiateTimeoutMs = options.negotiateTimeoutMs ?? DEFAULT_NEGOTIATE_TIMEOUT_MS;
        this.channelLabel = options.channelLabel ?? RTC_DATA_CHANNEL_LABEL;
        this.sendTimeoutMs = options.sendTimeoutMs;
        this.label = options.label;
        this.onDiagnostic = options.onDiagnostic;
        this.pc = options.factory.create({
            iceServers: options.iceServers,
            iceTransportPolicy: options.iceTransportPolicy,
            onDiagnostic: event => this.handlePeerDiagnostic(event),
        });
        this.pc.ondatachannel = event => this.adoptChannel(event.channel);
        this.pc.onicecandidate = event => {
            if (event.candidate !== null && !this.closed) {
                const candidate = summarizeIceCandidate(event.candidate);
                recordCandidate(this.localCandidateTelemetry, candidate);
                this.emitDiagnostic({ type: 'local-candidate', candidate, diagnostics: this.diagnostics() });
                this.onSignal({ type: 'ice', candidate: event.candidate });
            }
        };
        this.pc.onconnectionstatechange = () => {
            this.emitStateChange();
            this.checkConnectionState();
        };
        this.pc.oniceconnectionstatechange = () => {
            this.emitStateChange();
            this.checkConnectionState();
        };
        this.pc.onicegatheringstatechange = () => this.emitStateChange();
    }
    /** Begin negotiation; resolves when the DataChannel is open. */
    connect(signal) {
        if (this.closed)
            return Promise.reject(new RtcConnectError('RTC_CLOSED', 'WebRTC transport closed.'));
        if (signal?.aborted)
            return Promise.reject(new RtcConnectError('RTC_ABORTED', 'WebRTC negotiation was aborted.'));
        if (this.opened)
            return Promise.resolve();
        if (this.connectPromise !== undefined)
            return this.connectPromise;
        this.armAbort(signal);
        this.connectPromise = new Promise((resolve, reject) => {
            this.openResolve = resolve;
            this.openReject = reject;
            this.negotiateTimer = setTimeout(() => {
                void this.failOpenAfterStats(new RtcConnectError('RTC_CONNECT_TIMEOUT', `WebRTC negotiation timed out after ${this.negotiateTimeoutMs}ms.`));
            }, this.negotiateTimeoutMs);
            if (this.role === 'initiator') {
                void this.startInitiator().catch(error => this.failOpen(asError(error)));
            }
        });
        return this.connectPromise;
    }
    handleSignal(signal) {
        if (this.closed)
            return;
        if (signal.type === 'offer')
            void this.handleOffer(signal.sdp);
        else if (signal.type === 'answer')
            void this.handleAnswer(signal.sdp);
        else
            void this.handleIce(signal.candidate);
    }
    async send(data) {
        const channel = this.requireOpenChannel();
        if (channel.readyState !== 'open')
            throw new Error('WebRTC data channel is not open.');
        for (const frame of this.outgoing.encode(data)) {
            try {
                channel.send(toArrayBuffer(frame));
            }
            catch (error) {
                console.error('[rtc-send-error] bytes=' + frame.byteLength, error instanceof Error ? error.message : error);
                throw error;
            }
        }
        this.bytesSent += data.byteLength;
        this.armWatchdog(channel);
    }
    onMessage(handler) {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }
    onClose(handler) {
        this.closeHandlers.add(handler);
        return () => this.closeHandlers.delete(handler);
    }
    onError(handler) {
        this.errorHandlers.add(handler);
        return () => this.errorHandlers.delete(handler);
    }
    selectedTransport() {
        return this.selected;
    }
    selectedRelayUrl() {
        return this.selectedRelayUrlValue;
    }
    selectedPathMode() {
        return this.selectedMode;
    }
    diagnostics() {
        return {
            role: this.role,
            ...(this.label === undefined ? {} : { label: this.label }),
            connectionState: this.pc.connectionState,
            iceConnectionState: this.pc.iceConnectionState,
            iceGatheringState: this.pc.iceGatheringState,
            localCandidates: cloneCandidateTelemetry(this.localCandidateTelemetry),
            remoteCandidates: cloneCandidateTelemetry(this.remoteCandidateTelemetry),
            candidatePairs: cloneCandidatePairTelemetry(this.candidatePairTelemetry),
            filteredLocalCandidates: cloneCandidateTelemetry(this.filteredLocalCandidateTelemetry),
            filteredCandidatePairs: cloneCandidateTelemetry(this.filteredCandidatePairTelemetry),
            ...(this.selectedPathTelemetry === undefined ? {} : { selectedPath: { ...this.selectedPathTelemetry } }),
        };
    }
    async connectionDetails() {
        let statsDetails = {};
        try {
            statsDetails = await this.refreshStatsDiagnostics();
        }
        catch {
            // Peer/DataChannel state remains useful if the RTC backend withholds stats.
        }
        return {
            ...statsDetails,
            mode: statsDetails.mode ?? this.selectedMode,
            connectionState: this.pc.connectionState,
            iceConnectionState: this.pc.iceConnectionState,
            dataChannelState: this.channel?.readyState,
            diagnostics: this.diagnostics(),
        };
    }
    getStats() {
        const connected = this.channel?.readyState === 'open';
        return {
            mode: !connected
                ? 'Disconnected'
                : this.selectedMode ?? (this.selected === 'turn' ? 'TURN' : this.selected === 'lan' ? 'LAN' : 'P2P'),
            connected,
            bytesSent: this.bytesSent,
            bytesReceived: this.bytesReceived,
        };
    }
    /** Idempotent close: releases PeerConnection, DataChannel, timers and listeners. */
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.clearNegotiation();
        this.openReject?.(new RtcConnectError('RTC_CLOSED', 'WebRTC transport closed during negotiation.'));
        this.openResolve = undefined;
        this.openReject = undefined;
        this.clearWatchdog();
        const channel = this.channel;
        this.channel = undefined;
        if (channel !== undefined) {
            channel.onopen = null;
            channel.onmessage = null;
            channel.onclose = null;
            channel.onerror = null;
            channel.onbufferedamountlow = null;
            try {
                channel.close();
            }
            catch { /* already closed */ }
        }
        this.pc.onicecandidate = null;
        this.pc.ondatachannel = null;
        this.pc.onconnectionstatechange = null;
        this.pc.oniceconnectionstatechange = null;
        try {
            this.pc.close();
        }
        catch { /* already closed */ }
        if (this.opened) {
            this.opened = false;
            for (const handler of this.closeHandlers)
                handler();
        }
    }
    armAbort(signal) {
        this.removeAbort?.();
        this.removeAbort = undefined;
        if (signal === undefined)
            return;
        const onAbort = () => {
            this.failOpen(new RtcConnectError('RTC_ABORTED', 'WebRTC negotiation was aborted.'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.removeAbort = () => signal.removeEventListener('abort', onAbort);
        if (signal.aborted)
            onAbort();
    }
    async startInitiator() {
        const channel = this.pc.createDataChannel(this.channelLabel, RTC_DATA_CHANNEL_OPTIONS);
        this.adoptChannel(channel);
        const offer = await this.pc.createOffer();
        if (this.closed)
            return;
        await this.pc.setLocalDescription(offer);
        if (this.closed)
            return;
        this.onSignal({ type: 'offer', sdp: requireSdp(offer) });
    }
    async handleOffer(sdp) {
        if (this.role !== 'responder' || this.remoteDescriptionSet) {
            this.failOpen(new RtcConnectError('RTC_INVALID_STATE', 'Received an unexpected WebRTC offer.'));
            return;
        }
        try {
            await this.pc.setRemoteDescription({ type: 'offer', sdp });
            this.remoteDescriptionSet = true;
            await this.flushRemoteCandidates();
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.onSignal({ type: 'answer', sdp: requireSdp(answer) });
        }
        catch (error) {
            this.failOpen(asError(error));
        }
    }
    async handleAnswer(sdp) {
        if (this.role !== 'initiator' || this.remoteDescriptionSet) {
            this.failOpen(new RtcConnectError('RTC_INVALID_STATE', 'Received an unexpected WebRTC answer.'));
            return;
        }
        try {
            await this.pc.setRemoteDescription({ type: 'answer', sdp });
            this.remoteDescriptionSet = true;
            await this.flushRemoteCandidates();
        }
        catch (error) {
            this.failOpen(asError(error));
        }
    }
    async handleIce(candidate) {
        const summary = summarizeIceCandidate(candidate);
        if (!this.remoteDescriptionSet) {
            recordCandidate(this.remoteCandidateTelemetry, summary);
            this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'buffered', diagnostics: this.diagnostics() });
            this.remoteCandidates.push(candidate);
            return;
        }
        try {
            await this.pc.addIceCandidate(candidate);
            recordCandidate(this.remoteCandidateTelemetry, summary);
            this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'added', diagnostics: this.diagnostics() });
        }
        catch {
            this.emitDiagnostic({ type: 'remote-candidate', candidate: summary, action: 'ignored', diagnostics: this.diagnostics() });
            // Ignore malformed/duplicate candidates; the connection either proceeds
            // or the negotiation timeout surfaces the failure.
        }
    }
    async flushRemoteCandidates() {
        const buffered = this.remoteCandidates.splice(0, this.remoteCandidates.length);
        for (const candidate of buffered) {
            try {
                await this.pc.addIceCandidate(candidate);
            }
            catch { /* ignored */ }
        }
    }
    adoptChannel(channel) {
        if (this.channel !== undefined && this.channel !== channel) {
            try {
                channel.close();
            }
            catch { /* ignored */ }
            return;
        }
        this.channel = channel;
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => {
            if (this.closed || this.opened)
                return;
            this.opened = true;
            const resolve = this.openResolve;
            this.clearNegotiation();
            void this.resolveSelectedTransport().then(() => {
                if (this.closed)
                    return;
                this.openResolve = undefined;
                this.openReject = undefined;
                resolve?.();
            });
        };
        channel.onmessage = event => {
            if (this.closed || !this.opened)
                return;
            const data = event.data;
            const frame = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
            this.bytesReceived += frame.byteLength;
            try {
                const message = this.incoming.decode(frame);
                if (message === undefined)
                    return;
                for (const handler of this.messageHandlers)
                    handler(message);
            }
            catch {
                void this.close();
            }
        };
        channel.onclose = () => {
            if (this.closed)
                return;
            this.failOpen(new RtcConnectError('RTC_CLOSED', 'WebRTC data channel closed.'));
            if (this.opened) {
                this.opened = false;
                for (const handler of this.closeHandlers)
                    handler();
            }
        };
        channel.onerror = () => {
            const error = new RtcConnectError('RTC_FAILED', 'WebRTC data channel reported an error.');
            this.failOpen(error);
            for (const handler of this.errorHandlers)
                handler(error);
        };
    }
    async resolveSelectedTransport() {
        try {
            let selected = await this.refreshStatsDiagnostics();
            // Native libwebrtc can open the DataChannel one tick before the selected
            // candidate pair is exposed through getStats(). A one-shot read leaves
            // selectedMode undefined forever, which is then incorrectly presented as
            // generic P2P even when the eventual pair is LAN or TURN.
            for (let attempt = 0; attempt < SELECTED_PATH_RETRY_COUNT
                && !this.closed
                && (selected.transport === undefined || selected.mode === undefined || selected.mode === 'P2P'); attempt += 1) {
                await sleep(SELECTED_PATH_RETRY_DELAY_MS);
                selected = await this.refreshStatsDiagnostics();
            }
            this.selected = selected?.transport;
            this.selectedMode = selected?.mode;
            this.selectedRelayUrlValue = selected?.relayUrl;
            this.selectedPathTelemetry = selectedPathTelemetry(selected);
            this.emitDiagnostic({
                type: 'selected-path',
                selectedPath: this.selectedPathTelemetry,
                diagnostics: this.diagnostics(),
            });
        }
        catch {
            this.selected = undefined;
            this.selectedMode = undefined;
        }
    }
    checkConnectionState() {
        if (this.closed || this.opened)
            return;
        if (this.pc.connectionState === 'failed' || this.pc.iceConnectionState === 'failed'
            || this.pc.connectionState === 'closed' || this.pc.iceConnectionState === 'closed') {
            void this.failOpenAfterStats(new RtcConnectError('RTC_FAILED', 'WebRTC peer connection failed before the data channel opened.'));
        }
    }
    async failOpenAfterStats(error) {
        await this.refreshStatsDiagnostics().catch(() => undefined);
        this.failOpen(error);
    }
    failOpen(error) {
        if (this.closed || this.opened || this.openReject === undefined)
            return;
        const reject = this.openReject;
        this.clearNegotiation();
        this.openResolve = undefined;
        this.openReject = undefined;
        reject(error);
        void this.close();
    }
    clearNegotiation() {
        if (this.negotiateTimer !== undefined)
            clearTimeout(this.negotiateTimer);
        this.negotiateTimer = undefined;
        this.removeAbort?.();
        this.removeAbort = undefined;
    }
    requireOpenChannel() {
        const channel = this.channel;
        if (channel === undefined || channel.readyState !== 'open' || this.closed || !this.opened) {
            throw new Error('WebRTC data channel is not open.');
        }
        return channel;
    }
    armWatchdog(channel) {
        if (this.closed || this.sendTimeoutMs === undefined || this.sendTimeoutMs <= 0)
            return;
        if (this.watchdogTimer !== undefined)
            clearTimeout(this.watchdogTimer);
        this.watchdogTimer = undefined;
        const baseline = channel.bufferedAmount;
        if (baseline <= 0) {
            this.lastBufferedAmount = 0;
            return;
        }
        this.lastBufferedAmount = baseline;
        this.watchdogTimer = setTimeout(() => {
            this.watchdogTimer = undefined;
            if (this.closed || this.channel !== channel || channel.readyState !== 'open')
                return;
            const current = channel.bufferedAmount;
            if (current > 0 && current >= this.lastBufferedAmount) {
                // The outbound queue has not drained since the last check: the peer is
                // not ACKing. Treat the transport as unhealthy so the owner can fall
                // back instead of leaving the RPC sender queue blocked forever.
                const error = new RtcConnectError('RTC_SEND_TIMEOUT', 'DataChannel send stalled.');
                for (const handler of this.errorHandlers)
                    handler(error);
                void this.close();
                return;
            }
            this.lastBufferedAmount = current;
            if (current > 0)
                this.armWatchdog(channel);
        }, this.sendTimeoutMs);
    }
    clearWatchdog() {
        if (this.watchdogTimer !== undefined)
            clearTimeout(this.watchdogTimer);
        this.watchdogTimer = undefined;
        this.lastBufferedAmount = 0;
    }
    async refreshStatsDiagnostics() {
        // Native getStats() must not leave startup waiting after the channel opens.
        const stats = [...await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('WebRTC statistics timed out.')), 250);
                Promise.resolve().then(() => this.pc.getStats()).then(resolve, reject).finally(() => clearTimeout(timer));
            })];
        if (this.closed)
            return {};
        this.candidatePairTelemetry = inspectCandidatePairs(stats);
        return inspectSelectedPath(stats);
    }
    handlePeerDiagnostic(event) {
        if (event.type === 'local-candidate-filtered') {
            recordCandidate(this.filteredLocalCandidateTelemetry, event.candidate);
            this.emitDiagnostic({
                type: event.type,
                candidate: event.candidate,
                reason: event.reason,
                diagnostics: this.diagnostics(),
            });
            return;
        }
        if (event.localCandidate !== undefined)
            recordCandidate(this.filteredCandidatePairTelemetry, event.localCandidate);
        this.emitDiagnostic({
            type: event.type,
            localCandidate: event.localCandidate,
            reason: event.reason,
            diagnostics: this.diagnostics(),
        });
    }
    emitStateChange() {
        this.emitDiagnostic({
            type: 'state-change',
            connectionState: this.pc.connectionState,
            iceConnectionState: this.pc.iceConnectionState,
            iceGatheringState: this.pc.iceGatheringState,
            diagnostics: this.diagnostics(),
        });
    }
    emitDiagnostic(event) {
        try {
            this.onDiagnostic?.(event);
        }
        catch { /* diagnostics must not affect transport state */ }
    }
}
export class RtcConnectError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export function detectSelectedTransport(stats) {
    return detectSelectedPath(stats)?.transport;
}
export function detectSelectedPath(stats) {
    const details = inspectSelectedPath(stats);
    return details.transport === undefined || details.mode === undefined
        ? undefined
        : { transport: details.transport, mode: details.mode };
}
export function inspectSelectedPath(stats) {
    // candidate-pair `localCandidateId`/`remoteCandidateId` reference the `id`
    // member of the local/remote-candidate stats (not the report map key).
    const candidates = new Map();
    const candidatePairs = new Map();
    const selectedPairs = [];
    const selectedPairIds = new Set();
    for (const [reportId, entry] of stats) {
        if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
            if (typeof entry.candidateType === 'string' && entry.id !== undefined) {
                candidates.set(String(entry.id), entry);
            }
        }
        else if (entry.type === 'candidate-pair') {
            candidatePairs.set(String(entry.id ?? reportId), entry);
            if (entry.selected === true || entry.nominated === true)
                selectedPairs.push(entry);
        }
        else if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
            selectedPairIds.add(entry.selectedCandidatePairId);
        }
    }
    const pairs = [
        ...[...selectedPairIds].map(id => candidatePairs.get(id)).filter((pair) => pair !== undefined),
        ...selectedPairs,
    ];
    for (const pair of pairs) {
        const local = candidates.get(String(pair.localCandidateId));
        const remote = candidates.get(String(pair.remoteCandidateId));
        const localType = local?.candidateType;
        const remoteType = remote?.candidateType;
        const localAddressScope = summarizeAddress(candidateAddressValue(local)).addressScope;
        const remoteAddressScope = summarizeAddress(candidateAddressValue(remote)).addressScope;
        let selected;
        if (localType === 'relay' || remoteType === 'relay')
            selected = { transport: 'turn', mode: 'TURN' };
        const relayUrl = localType === 'relay' ? stringStat(local, 'url') : undefined;
        if (local === undefined && remote === undefined)
            continue;
        const lan = isLanCandidatePair(localType, remoteType, localAddressScope, remoteAddressScope);
        selected ??= { transport: lan ? 'lan' : 'p2p', mode: lan ? 'LAN' : 'P2P' };
        const currentRoundTripTime = numberStat(pair, 'currentRoundTripTime');
        return {
            ...selected,
            ...(relayUrl === undefined ? {} : { relayUrl }),
            localCandidateType: stringStat(local, 'candidateType'),
            remoteCandidateType: stringStat(remote, 'candidateType'),
            localAddressScope,
            remoteAddressScope,
            localAddress: candidateAddress(local),
            remoteAddress: candidateAddress(remote),
            protocol: stringStat(local, 'protocol') ?? stringStat(remote, 'protocol'),
            relayProtocol: stringStat(local, 'relayProtocol') ?? stringStat(remote, 'relayProtocol'),
            currentRoundTripTimeMs: currentRoundTripTime === undefined
                ? undefined
                : Math.round(currentRoundTripTime * 1000),
            availableOutgoingBitrate: numberStat(pair, 'availableOutgoingBitrate'),
            bytesSent: numberStat(pair, 'bytesSent'),
            bytesReceived: numberStat(pair, 'bytesReceived'),
        };
    }
    return {};
}
export function inspectCandidatePairs(stats) {
    const candidates = new Map();
    const telemetry = emptyCandidatePairTelemetry();
    const pairs = [];
    for (const [reportId, entry] of stats) {
        if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
            if (typeof entry.candidateType === 'string' && entry.id !== undefined) {
                candidates.set(String(entry.id), entry);
            }
        }
        else if (entry.type === 'candidate-pair') {
            pairs.push({ ...entry, id: entry.id ?? reportId });
        }
    }
    for (const pair of pairs) {
        telemetry.total += 1;
        if (pair.nominated === true)
            telemetry.nominated += 1;
        if (pair.selected === true)
            telemetry.selected += 1;
        increment(telemetry.byState, stringStat(pair, 'state') ?? (pair.selected === true ? 'selected' : 'unknown'));
        const local = candidates.get(String(pair.localCandidateId));
        const remote = candidates.get(String(pair.remoteCandidateId));
        recordCandidateStats(telemetry.byLocalType, telemetry.byLocalFamily, telemetry.byLocalScope, local);
        recordCandidateStats(telemetry.byRemoteType, telemetry.byRemoteFamily, telemetry.byRemoteScope, remote);
    }
    return telemetry;
}
function candidateAddress(candidate) {
    const address = stringStat(candidate, 'address') ?? stringStat(candidate, 'ip');
    if (address === undefined)
        return undefined;
    const port = numberStat(candidate, 'port');
    return port === undefined ? address : `${address}:${port}`;
}
function stringStat(entry, key) {
    const value = entry?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function numberStat(entry, key) {
    const value = entry?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function emptyCandidateTelemetry() {
    return {
        total: 0,
        byType: {},
        byFamily: {},
        byScope: {},
        byProtocol: {},
    };
}
function cloneCandidateTelemetry(value) {
    return {
        total: value.total,
        byType: { ...value.byType },
        byFamily: { ...value.byFamily },
        byScope: { ...value.byScope },
        byProtocol: { ...value.byProtocol },
    };
}
function emptyCandidatePairTelemetry() {
    return {
        total: 0,
        nominated: 0,
        selected: 0,
        byState: {},
        byLocalType: {},
        byRemoteType: {},
        byLocalFamily: {},
        byRemoteFamily: {},
        byLocalScope: {},
        byRemoteScope: {},
    };
}
function cloneCandidatePairTelemetry(value) {
    return {
        total: value.total,
        nominated: value.nominated,
        selected: value.selected,
        byState: { ...value.byState },
        byLocalType: { ...value.byLocalType },
        byRemoteType: { ...value.byRemoteType },
        byLocalFamily: { ...value.byLocalFamily },
        byRemoteFamily: { ...value.byRemoteFamily },
        byLocalScope: { ...value.byLocalScope },
        byRemoteScope: { ...value.byRemoteScope },
    };
}
function recordCandidate(telemetry, candidate) {
    telemetry.total += 1;
    increment(telemetry.byType, candidate.candidateType);
    increment(telemetry.byFamily, candidate.addressFamily);
    increment(telemetry.byScope, candidate.addressScope);
    if (candidate.protocol !== undefined)
        increment(telemetry.byProtocol, candidate.protocol);
}
function recordCandidateStats(byType, byFamily, byScope, candidate) {
    const candidateType = candidateTypeStat(candidate);
    const address = summarizeAddress(candidateAddressValue(candidate));
    increment(byType, candidateType);
    increment(byFamily, address.addressFamily);
    increment(byScope, address.addressScope);
}
function candidateTypeStat(candidate) {
    const value = stringStat(candidate, 'candidateType');
    if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay')
        return value;
    return 'unknown';
}
function candidateAddressValue(candidate) {
    return stringStat(candidate, 'address') ?? stringStat(candidate, 'ip');
}
function isLanCandidatePair(localType, remoteType, localScope, remoteScope) {
    if (localType === 'host' && remoteType === 'host') {
        // Keep address-hidden/mDNS host pairs compatible, but do not label an
        // explicitly identified overlay or public host pair as physical LAN.
        return !isExplicitlyNonLanScope(localScope) && !isExplicitlyNonLanScope(remoteScope);
    }
    const directTypes = new Set(['host', 'prflx']);
    if (!directTypes.has(String(localType)) || !directTypes.has(String(remoteType)))
        return false;
    if (isLocalNetworkScope(localScope) && isLocalNetworkScope(remoteScope))
        return true;
    // libwebrtc commonly represents an mDNS-obscured LAN endpoint as prflx and
    // withholds its address from getStats(). Keep an explicitly public/cgnat
    // peer-reflexive endpoint as P2P, but accept the private host + unknown prflx
    // shape emitted by Android and @roamhq/wrtc for a selected LAN path.
    return (localType === 'host' && isLocalNetworkScope(localScope)
        && remoteType === 'prflx' && remoteScope === 'unknown')
        || (remoteType === 'host' && isLocalNetworkScope(remoteScope)
            && localType === 'prflx' && localScope === 'unknown');
}
function isLocalNetworkScope(scope) {
    return scope === 'private' || scope === 'link-local' || scope === 'loopback';
}
function isExplicitlyNonLanScope(scope) {
    return scope === 'public' || scope === 'cgnat' || scope === 'reserved';
}
function increment(map, key) {
    map[key] = (map[key] ?? 0) + 1;
}
function selectedPathTelemetry(details) {
    return {
        ...(details.transport === undefined ? {} : { transport: details.transport }),
        ...(details.mode === undefined ? {} : { mode: details.mode }),
        ...(details.relayUrl === undefined ? {} : { relayUrl: details.relayUrl }),
        ...(details.localCandidateType === undefined ? {} : { localCandidateType: details.localCandidateType }),
        ...(details.remoteCandidateType === undefined ? {} : { remoteCandidateType: details.remoteCandidateType }),
        ...(details.localAddressScope === undefined ? {} : { localAddressScope: details.localAddressScope }),
        ...(details.remoteAddressScope === undefined ? {} : { remoteAddressScope: details.remoteAddressScope }),
        ...(details.protocol === undefined ? {} : { protocol: details.protocol }),
        ...(details.relayProtocol === undefined ? {} : { relayProtocol: details.relayProtocol }),
        ...(details.currentRoundTripTimeMs === undefined ? {} : { currentRoundTripTimeMs: details.currentRoundTripTimeMs }),
        ...(details.availableOutgoingBitrate === undefined ? {} : { availableOutgoingBitrate: details.availableOutgoingBitrate }),
    };
}
function requireSdp(description) {
    if (typeof description.sdp !== 'string' || description.sdp.length === 0) {
        throw new RtcConnectError('RTC_FAILED', 'The RTC backend produced an empty session description.');
    }
    return description.sdp;
}
function toArrayBuffer(data) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
        return data.buffer;
    return data.slice().buffer;
}
function asError(error) {
    return error instanceof Error ? error : new RtcConnectError('RTC_FAILED', 'WebRTC negotiation failed.');
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
