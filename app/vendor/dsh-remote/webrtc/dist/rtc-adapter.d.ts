/**
 * Environment-agnostic RTC peer-connection surface.
 *
 * The transport state machine only talks to these narrow interfaces so the
 * browser native `RTCPeerConnection` and a future Node host backend can both
 * provide the underlying peer connection without the business code depending
 * on a specific RTC implementation (webrtc-implementation-plan.md §6.1/§6.2).
 */
export interface RtcIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
}
export interface RtcIceCandidateInit {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
}
export type RtcCandidateType = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
export type RtcAddressFamily = 'ipv4' | 'ipv6' | 'unknown';
export type RtcAddressScope = 'private' | 'public' | 'loopback' | 'link-local' | 'cgnat' | 'reserved' | 'unknown';
export interface RtcCandidateSummary {
    candidateType: RtcCandidateType;
    protocol?: string;
    addressFamily: RtcAddressFamily;
    addressScope: RtcAddressScope;
    relatedAddressFamily?: RtcAddressFamily;
    relatedAddressScope?: RtcAddressScope;
}
export type RtcPeerConnectionDiagnosticEvent = {
    type: 'local-candidate-filtered';
    candidate: RtcCandidateSummary;
    reason: string;
} | {
    type: 'candidate-pair-filtered';
    localCandidate?: RtcCandidateSummary;
    reason: string;
};
export interface RtcPeerConnectionConfiguration {
    iceServers?: RtcIceServer[];
    iceTransportPolicy?: 'all' | 'relay';
    onDiagnostic?: (event: RtcPeerConnectionDiagnosticEvent) => void;
}
export interface RtcSessionDescriptionInit {
    type: 'offer' | 'answer';
    sdp?: string;
}
export interface RtcDataChannelInit {
    ordered?: boolean;
}
export interface RtcDataChannel {
    readonly label: string;
    readonly ordered: boolean;
    readyState: 'connecting' | 'open' | 'closing' | 'closed';
    bufferedAmount: number;
    binaryType: string;
    onopen: (() => void) | null;
    onmessage: ((event: {
        data: ArrayBuffer | string;
    }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    onbufferedamountlow: (() => void) | null;
    send(data: ArrayBuffer | string): void;
    close(): void;
}
export interface RtcPeerConnection {
    connectionState: string;
    iceConnectionState: string;
    iceGatheringState: string;
    signalingState: string;
    onconnectionstatechange: (() => void) | null;
    oniceconnectionstatechange: (() => void) | null;
    onicegatheringstatechange: (() => void) | null;
    onicecandidate: ((event: {
        candidate: RtcIceCandidateInit | null;
    }) => void) | null;
    ondatachannel: ((event: {
        channel: RtcDataChannel;
    }) => void) | null;
    createDataChannel(label: string, options?: RtcDataChannelInit): RtcDataChannel;
    createOffer(): Promise<RtcSessionDescriptionInit>;
    createAnswer(): Promise<RtcSessionDescriptionInit>;
    setLocalDescription(description?: RtcSessionDescriptionInit): Promise<void>;
    setRemoteDescription(description: RtcSessionDescriptionInit): Promise<void>;
    addIceCandidate(candidate?: RtcIceCandidateInit): Promise<void>;
    getStats(): Promise<RtcStats>;
    close(): void;
}
/** A single WebRTC stats report entry (id -> typed record). */
export interface RtcStatsEntry {
    type?: string;
    [key: string]: unknown;
}
export type RtcStats = Iterable<readonly [string, RtcStatsEntry]>;
export interface RtcPeerConnectionFactory {
    create(configuration: RtcPeerConnectionConfiguration): RtcPeerConnection;
}
export declare const RTC_DATA_CHANNEL_LABEL = "dsh";
export declare const RTC_DATA_CHANNEL_OPTIONS: {
    readonly ordered: true;
};
/**
 * Default browser-backed factory. This module is the only place in the webrtc
 * package that references the DOM `RTCPeerConnection` global, so Node hosts
 * inject their own factory and never import browser natives.
 */
export declare function browserRtcFactory(): RtcPeerConnectionFactory;
export declare function summarizeIceCandidate(candidate: RtcIceCandidateInit | undefined): RtcCandidateSummary;
export declare function summarizeAddress(address: string | undefined): {
    addressFamily: RtcAddressFamily;
    addressScope: RtcAddressScope;
};
export declare function stunOnlyIceServers(iceServers: readonly RtcIceServer[]): RtcIceServer[];
