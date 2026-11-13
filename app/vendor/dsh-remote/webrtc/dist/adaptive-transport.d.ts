import { type ErrorCode, type TransportStats } from '@dsh-remote/protocol';
import { type RtcIceServer, type RtcPeerConnectionFactory } from './rtc-adapter.js';
import { type RtcConnectionDiagnostics, type RtcConnectionDetails, type RtcDiagnosticEvent } from './rtc-data-channel.js';
import { BaseTransport } from './transport.js';
export interface AdaptiveTransportOptions {
    role: 'client';
    deviceId: string;
    accessToken: string;
    refreshAccessToken?: () => Promise<string>;
    targetDeviceId: string;
    capabilities?: string[];
    preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>;
    forceRelay?: boolean;
    /** Control authorization only, ending at connect.accepted. */
    handshakeTimeoutMs?: number;
    negotiateTimeoutMs?: number;
    iceServersTimeoutMs?: number;
    signal?: AbortSignal;
    rtcFactory?: RtcPeerConnectionFactory;
    fetchIceServers?: (connectionId: string, signal?: AbortSignal) => Promise<RtcIceServer[]>;
    onWebRtcFallback?: (error: Error, diagnostics?: RtcConnectionDiagnostics) => void;
    onWebRtcDiagnostic?: (event: RtcDiagnosticEvent) => void;
    /** Payload-free diagnostics for an established carrier closing. */
    onDisconnect?: (event: AdaptiveDisconnectDiagnostic) => void;
}
export interface AdaptiveDisconnectDiagnostic {
    reason: 'control-closed' | 'control-error' | 'invalid-control-frame' | 'webrtc-closed';
    closeCode?: number;
    errorCode?: ErrorCode;
    closeReason?: string;
    /** Selected data-plane transport of an established WebRTC path that closed. */
    transport?: 'lan' | 'p2p' | 'turn';
}
export interface AdaptiveConnectionDetails {
    connectionId?: string;
    connectedAt?: number;
    heartbeatIntervalMs?: number;
    lastControlReceivedAt?: number;
    lastControlSentAt?: number;
    recoveryExpiresAt?: number;
    controlChannelUrl: string;
    controlChannelState: 'connecting' | 'open' | 'closing' | 'closed';
    preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>;
    negotiatedCapabilities: string[];
    webRtcEnabled: boolean;
    webRtc?: RtcConnectionDetails;
}
/**
 * Client-side adaptive transport: `p2p -> turn -> relay` (webrtc plan §4/§6.4).
 *
 * Owns the Server control WebSocket and negotiates the data plane after
 * `connect.accepted`. WebRTC (initiator) is attempted first unless
 * `forceRelay` is set or no RTC backend is available; every failure path
 * closes the RTC state and falls back to the WebSocket Relay data plane.
 * Noise IK always runs over `secure.handshake` control frames; only the Noise
 * ciphertext moves to the DataChannel once WebRTC is established.
 */
export declare class AdaptiveTransport extends BaseTransport {
    private readonly url;
    private readonly options;
    private readonly handshakeHandlers;
    private socket?;
    private dataSocket?;
    private connectionId?;
    private relayCounter;
    private bytesSent;
    private bytesReceived;
    private dataMode;
    private selected?;
    private rtc?;
    private readyResolve?;
    private readyReject?;
    private handshakeTimer?;
    private lifetime?;
    private removeAbort?;
    private webrtcEnabled;
    private serverNegotiateTimeoutMs?;
    private negotiatedCapabilities;
    private controlFrameLimits;
    private connectedAt?;
    private heartbeatIntervalMs?;
    private lastControlReceivedAt?;
    private lastControlSentAt?;
    private lastRtcDiagnostics?;
    private relayAssignment?;
    private dataReady;
    private recoveryTicket?;
    private relayRecoveryTicket?;
    private lease?;
    private recoveryTimer?;
    private recoveryOpeningTimer?;
    private recoveryAttempt;
    private controlReady;
    constructor(url: string, options: AdaptiveTransportOptions);
    connect(): Promise<void>;
    send(data: Uint8Array): Promise<void>;
    connectionInfo(): {
        connectionId: string;
        localDeviceId: string;
        remoteDeviceId: string;
    };
    connectionDetails(): Promise<AdaptiveConnectionDetails>;
    sendHandshake(step: number, data: Uint8Array): Promise<void>;
    onHandshake(cb: (step: number, data: Uint8Array) => void): () => void;
    close(): Promise<void>;
    getStats(): TransportStats;
    private handleSocketMessage;
    private handleRelay;
    private negotiate;
    private negotiatedTransports;
    private tryWebRtc;
    markSecureReady(): void;
    private controlLost;
    private reopenControl;
    private fetchIceServers;
    private sendRtcSignal;
    private openDataSocket;
    private handleDataSocketFrame;
    private sendControl;
    private finishConnection;
    private failConnection;
    private clearHandshake;
}
/** Full-jitter window of every control-recovery attempt. */
export declare const CONTROL_RECOVERY_MAX_DELAY_MS = 15000;
/**
 * Delay before the next control-recovery attempt.
 *
 * `attempt` is the index of the attempt *about to be scheduled*: 0 is the
 * first retry after losing the control channel.
 *
 * Every disconnect backs off into the widest window (`[0, 15s]`, full jitter)
 * and stays there: a short outage still recovers quickly on average, while a
 * tight retry loop against a failing control plane is impossible. The Server
 * restart reason is classified separately for session retention but no longer
 * changes the delay, because a restart is already the worst case of the same
 * window.
 */
export declare function recoveryDelayMs(_attempt: number, _diagnostic: AdaptiveDisconnectDiagnostic): number;
