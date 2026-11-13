import type { TransportStats } from '@dsh-remote/protocol';
import { type RtcAddressFamily, type RtcAddressScope, type RtcCandidateSummary, type RtcCandidateType, type RtcDataChannel, type RtcIceCandidateInit, type RtcIceServer, type RtcPeerConnectionFactory, type RtcStats } from './rtc-adapter.js';
export type RtcRole = 'initiator' | 'responder';
export type RtcSelectedTransport = 'lan' | 'p2p' | 'turn';
export type RtcPathMode = 'LAN' | 'P2P' | 'TURN';
export interface RtcSelectedPath {
    transport: RtcSelectedTransport;
    mode: RtcPathMode;
}
export interface RtcPathDetails {
    transport?: RtcSelectedTransport;
    mode?: RtcPathMode;
    relayUrl?: string;
    localCandidateType?: string;
    remoteCandidateType?: string;
    localAddressScope?: RtcAddressScope;
    remoteAddressScope?: RtcAddressScope;
    localAddress?: string;
    remoteAddress?: string;
    protocol?: string;
    relayProtocol?: string;
    currentRoundTripTimeMs?: number;
    availableOutgoingBitrate?: number;
    bytesSent?: number;
    bytesReceived?: number;
}
export interface RtcConnectionDetails extends RtcPathDetails {
    connectionState: string;
    iceConnectionState: string;
    dataChannelState?: RtcDataChannel['readyState'];
    diagnostics: RtcConnectionDiagnostics;
}
export interface RtcCandidateTelemetry {
    total: number;
    byType: Partial<Record<RtcCandidateType, number>>;
    byFamily: Partial<Record<RtcAddressFamily, number>>;
    byScope: Partial<Record<RtcAddressScope, number>>;
    byProtocol: Record<string, number>;
}
export interface RtcCandidatePairTelemetry {
    total: number;
    nominated: number;
    selected: number;
    byState: Record<string, number>;
    byLocalType: Partial<Record<RtcCandidateType, number>>;
    byRemoteType: Partial<Record<RtcCandidateType, number>>;
    byLocalFamily: Partial<Record<RtcAddressFamily, number>>;
    byRemoteFamily: Partial<Record<RtcAddressFamily, number>>;
    byLocalScope: Partial<Record<RtcAddressScope, number>>;
    byRemoteScope: Partial<Record<RtcAddressScope, number>>;
}
export interface RtcSelectedPathTelemetry {
    transport?: RtcSelectedTransport;
    mode?: RtcPathMode;
    relayUrl?: string;
    localCandidateType?: string;
    remoteCandidateType?: string;
    localAddressScope?: RtcAddressScope;
    remoteAddressScope?: RtcAddressScope;
    protocol?: string;
    relayProtocol?: string;
    currentRoundTripTimeMs?: number;
    availableOutgoingBitrate?: number;
}
export interface RtcConnectionDiagnostics {
    role: RtcRole;
    label?: string;
    connectionState: string;
    iceConnectionState: string;
    iceGatheringState: string;
    localCandidates: RtcCandidateTelemetry;
    remoteCandidates: RtcCandidateTelemetry;
    candidatePairs: RtcCandidatePairTelemetry;
    filteredLocalCandidates: RtcCandidateTelemetry;
    filteredCandidatePairs: RtcCandidateTelemetry;
    selectedPath?: RtcSelectedPathTelemetry;
}
export type RtcDiagnosticEvent = {
    type: 'local-candidate';
    candidate: RtcCandidateSummary;
    diagnostics: RtcConnectionDiagnostics;
} | {
    type: 'remote-candidate';
    candidate: RtcCandidateSummary;
    action: 'buffered' | 'added' | 'ignored';
    diagnostics: RtcConnectionDiagnostics;
} | {
    type: 'local-candidate-filtered';
    candidate: RtcCandidateSummary;
    reason: string;
    diagnostics: RtcConnectionDiagnostics;
} | {
    type: 'candidate-pair-filtered';
    localCandidate?: RtcCandidateSummary;
    reason: string;
    diagnostics: RtcConnectionDiagnostics;
} | {
    type: 'state-change';
    connectionState: string;
    iceConnectionState: string;
    iceGatheringState: string;
    diagnostics: RtcConnectionDiagnostics;
} | {
    type: 'selected-path';
    selectedPath: RtcSelectedPathTelemetry;
    diagnostics: RtcConnectionDiagnostics;
};
export type RtcSignal = {
    type: 'offer';
    sdp: string;
} | {
    type: 'answer';
    sdp: string;
} | {
    type: 'ice';
    candidate: RtcIceCandidateInit;
};
export interface RtcDataChannelTransportOptions {
    role: RtcRole;
    iceServers?: RtcIceServer[];
    iceTransportPolicy?: 'all' | 'relay';
    factory: RtcPeerConnectionFactory;
    onSignal: (signal: RtcSignal) => void;
    negotiateTimeoutMs?: number;
    channelLabel?: string;
    /**
     * Optional send watchdog for RTC implementations whose `bufferedAmount`
     * reliably returns to zero. Disabled by default because React Native and
     * some werift versions retain a positive value after data was delivered.
     */
    sendTimeoutMs?: number;
    /** Human-readable diagnostic label; never logged with sensitive content. */
    label?: string;
    /** Candidate/state telemetry hook. Events never contain SDP, credentials, or payload bytes. */
    onDiagnostic?: (event: RtcDiagnosticEvent) => void;
}
/**
 * Complete WebRTC DataChannel transport state machine (webrtc plan §6.1).
 *
 * Owns one `RTCPeerConnection` + ordered `dsh` DataChannel for a single
 * connection establishment. It emits offer/answer/trickle-ICE via `onSignal`
 * and consumes the peer's signaling through `handleSignal`; the owner wires
 * those two ends to the Server control channel. `connect()` resolves only
 * once the DataChannel reaches `open`.
 */
export declare class RtcDataChannelTransport {
    private readonly pc;
    private readonly role;
    private readonly onSignal;
    private readonly negotiateTimeoutMs;
    private readonly channelLabel;
    private readonly sendTimeoutMs?;
    private readonly label?;
    private readonly onDiagnostic?;
    private channel?;
    private readonly remoteCandidates;
    private remoteDescriptionSet;
    private opened;
    private closed;
    private readonly messageHandlers;
    private readonly closeHandlers;
    private readonly errorHandlers;
    private connectPromise?;
    private openResolve?;
    private openReject?;
    private negotiateTimer?;
    private removeAbort?;
    private watchdogTimer?;
    private readonly outgoing;
    private readonly incoming;
    private bytesSent;
    private bytesReceived;
    private selected?;
    private selectedMode?;
    private selectedRelayUrlValue?;
    private selectedPathTelemetry?;
    private readonly localCandidateTelemetry;
    private readonly remoteCandidateTelemetry;
    private candidatePairTelemetry;
    private readonly filteredLocalCandidateTelemetry;
    private readonly filteredCandidatePairTelemetry;
    private lastBufferedAmount;
    constructor(options: RtcDataChannelTransportOptions);
    /** Begin negotiation; resolves when the DataChannel is open. */
    connect(signal?: AbortSignal): Promise<void>;
    handleSignal(signal: RtcSignal): void;
    send(data: Uint8Array): Promise<void>;
    onMessage(handler: (data: Uint8Array) => void): () => void;
    onClose(handler: () => void): () => void;
    onError(handler: (error: Error) => void): () => void;
    selectedTransport(): RtcSelectedTransport | undefined;
    selectedRelayUrl(): string | undefined;
    selectedPathMode(): RtcPathMode | undefined;
    diagnostics(): RtcConnectionDiagnostics;
    connectionDetails(): Promise<RtcConnectionDetails>;
    getStats(): TransportStats;
    /** Idempotent close: releases PeerConnection, DataChannel, timers and listeners. */
    close(): Promise<void>;
    private armAbort;
    private startInitiator;
    private handleOffer;
    private handleAnswer;
    private handleIce;
    private flushRemoteCandidates;
    private adoptChannel;
    private resolveSelectedTransport;
    private checkConnectionState;
    private failOpenAfterStats;
    private failOpen;
    private clearNegotiation;
    private requireOpenChannel;
    private armWatchdog;
    private clearWatchdog;
    private refreshStatsDiagnostics;
    private handlePeerDiagnostic;
    private emitStateChange;
    private emitDiagnostic;
}
export declare class RtcConnectError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function detectSelectedTransport(stats: RtcStats): RtcSelectedTransport | undefined;
export declare function detectSelectedPath(stats: RtcStats): RtcSelectedPath | undefined;
export declare function inspectSelectedPath(stats: RtcStats): RtcPathDetails;
export declare function inspectCandidatePairs(stats: RtcStats): RtcCandidatePairTelemetry;
