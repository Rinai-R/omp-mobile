export * from './loopback.js';
export { parseWireJson } from './wire-json.js';
import { z } from 'zod';
export declare const WEBRTC_RESUME_CAPABILITY = "transport.webrtc.resume.v1";
export declare const RELAY_RESUME_CAPABILITY = "transport.relay.resume.v1";
export declare const WEBRTC_LEASE_MS = 300000;
export { SERVER_SHUTDOWN_REASON, SERVER_SHUTDOWN_CLOSE_CODES, HEARTBEAT_TIMEOUT_CLOSE_CODE, HEARTBEAT_TIMEOUT_REASON, HEARTBEAT_CONNECTION_FAILED_REASON, TRANSIENT_CONTROL_CLOSE_CODES, TERMINAL_CONTROL_CLOSE_CODES, isServerShutdownClose, isHeartbeatTimeoutClose, classifyControlClose, type ControlCloseClassification, } from './close-semantics.js';
/**
 * WebSocket close code a Server uses when shutting down for restart.
 *
 * Deployments disagree on the code (`apps/server` sends 4009, the hosted
 * Server sends 4001 and reserves 4009 for heartbeat expiry), so endpoints must
 * classify with `isServerShutdownClose()` / `classifyControlClose()` and never
 * by comparing the code alone.
 */
export declare const SERVER_SHUTDOWN_CLOSE_CODE = 4009;
/** Close reason paired with the shutdown code; this is the semantic key. */
export declare const SERVER_SHUTDOWN_CLOSE_REASON: string;
export declare const PROTOCOL_VERSION = 1;
export declare const MAX_CONTROL_FRAME_BYTES: number;
export declare const MAX_RELAY_FRAME_BYTES: number;
export declare const SECURE_FRAGMENT_CHUNK_BYTES: number;
export declare const MAX_SECURE_MESSAGE_BYTES: number;
/** Decoded bytes carried by one authenticated Harness business transfer chunk. */
export declare const HARNESS_API_TRANSFER_CHUNK_BYTES: number;
/** Decoded bytes carried by one authenticated Codex domain transfer chunk. */
export declare const CODEX_APP_TRANSFER_CHUNK_BYTES: number;
/** Decoded bytes carried by one authenticated Agent ACP domain transfer chunk. */
export declare const AGENT_ACP_TRANSFER_CHUNK_BYTES: number;
/**
 * Bounded transfer size for Harness image prompts. The upstream default admits
 * up to 200 MiB of source images; their base64 JSON envelope needs roughly
 * 267 MiB, so 288 MiB leaves room for the native request structure.
 */
export declare const MAX_HARNESS_API_TRANSFER_BYTES: number;
export declare const MAX_CODEX_APP_TRANSFER_BYTES: number;
export declare const MAX_AGENT_ACP_TRANSFER_BYTES: number;
export declare const MAX_DEVICE_NAME_LENGTH = 128;
export declare const MAX_DEVICE_PLATFORM_LENGTH = 64;
export declare const MAX_DEVICE_VERSION_LENGTH = 64;
export declare const MAX_AUTH_TOKEN_LENGTH: number;
/** Maximum entries accepted in capability and workspace type advertisements. */
export declare const MAX_REMOTE_CAPABILITY_ENTRIES = 128;
export declare const MAX_REMOTE_WORKSPACE_TYPE_ENTRIES = 32;
/** Hello frame must arrive within this timeout after WebSocket open. */
export declare const HELLO_TIMEOUT_MS = 5000;
/** Host registration code time-to-live. */
export declare const HOST_REGISTRATION_CODE_TTL_MS: number;
/** Default control channel heartbeat interval. */
export declare const DEFAULT_HEARTBEAT_INTERVAL_MS = 25000;
/** Disconnection threshold: no valid pong within this window. */
export declare const HEARTBEAT_DISCONNECT_MS = 75000;
/** Maximum in-flight RPC requests per connection. */
export declare const MAX_PENDING_RPC_PER_CONNECTION = 128;
/** Maximum pending permission requests per session. */
export declare const MAX_PENDING_PERMISSION_PER_SESSION = 16;
/** Maximum ICE candidates收集 per connection. */
export declare const MAX_ICE_CANDIDATES_PER_CONNECTION = 256;
/** Maximum active transfers per direction per connection. */
export declare const MAX_ACTIVE_TRANSFERS_PER_DIRECTION = 2;
/** Transfer idle timeout before automatic cleanup. */
export declare const TRANSFER_IDLE_MS: number;
/** Maximum RPC text input size. */
export declare const MAX_RPC_TEXT_INPUT_BYTES: number;
/** Maximum File Viewer range per RPC call. */
export declare const MAX_FILEVIEWER_RANGE_BYTES: number;
/** Maximum directory entries returned by File Viewer per RPC. */
export declare const MAX_FILEVIEWER_DIRECTORY_ENTRIES = 1000;
/** Minimum event replay window by event count. */
export declare const MIN_REPLAY_WINDOW_EVENTS = 10000;
/** Minimum event replay window by time. */
export declare const MIN_REPLAY_WINDOW_MS: number;
/** Maximum concurrent alpha streams per connection. */
export declare const MAX_ALPHA_STREAMS_PER_CONNECTION = 16;
/** Generic Agent Client Protocol capability and bounded gateway limits. */
export declare const ACP_CAPABILITY: "agent.acp.v1";
export declare const ACP_PI_CAPABILITY: "agent.acp.pi.v1";
export declare const ACP_WORKSPACE_FILES_CAPABILITY: "agent.acp.workspace-files.v1";
export declare const ACP_TERMINAL_CAPABILITY: "agent.acp.terminal.v1";
export declare const ACP_ANTIGRAVITY_MODELS_CAPABILITY: "agent.acp.antigravity.models.v1";
export declare const ACP_ANTIGRAVITY_MODEL_LOAD_CAPABILITY: "agent.acp.antigravity.model-load.v1";
export declare const ACP_OPENCODE_CAPABILITY: "agent.acp.opencode.v1";
export declare const ACP_OPENCODE_ARCHIVE_CAPABILITY: "agent.acp.opencode.archive.v1";
export declare const ACP_TOOL_CALL_ENDPOINTS: readonly ["workspaceFiles/list", "workspaceFiles/stat", "workspaceFiles/read", "workspaceFiles/readBytes", "workspaceFiles/readAll", "terminal/environment", "terminal/shells", "terminal/list", "terminal/create", "terminal/write", "terminal/resize", "terminal/rename", "terminal/close"];
export declare const ACP_TOOL_STREAM_ENDPOINTS: readonly ["workspaceFiles/changes", "terminal/follow", "terminal/retain"];
export interface AcpModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface AcpSessionModels {
    current: AcpModelSelection;
    routable: boolean;
    groups: Array<{
        id: string;
        name: string;
        models: Array<{
            id: string;
            name: string;
            reasoning?: {
                efforts: Array<{
                    id: string;
                    name: string;
                }>;
                defaultEffort?: string;
            };
        }>;
    }>;
    failures: Array<{
        id: string;
        name: string;
        message: string;
    }>;
}
export declare const MAX_ACP_PROMPT_BYTES: number;
export declare const MAX_ACP_UPDATE_BYTES: number;
export declare const messageTypes: readonly ["rpc.request", "rpc.response", "rpc.error", "event"];
export declare const controlFrameTypes: readonly ["hello", "hello.ack", "connect.request", "connect.incoming", "connect.accepted", "connect.rejected", "secure.handshake", "relay", "signal.offer", "signal.answer", "signal.ice", "transport.selected", "connection.lease.request", "connection.lease.ack", "connection.lease.close", "ping", "pong", "error"];
export declare const rpcMethods: readonly ["workspace.upload.open", "workspace.upload.chunk", "workspace.upload.commit", "workspace.upload.abort", "harness.transport.describe", "remote.history.configure", "harness.api.call", "harness.api.transfer.open", "harness.api.transfer.chunk", "harness.api.transfer.commit", "harness.api.transfer.read", "harness.api.transfer.close", "harness.api.respond", "harness.api.stream.open", "harness.api.stream.close", "harness.remote.call", "harness.remote.transfer.open", "harness.remote.transfer.chunk", "harness.remote.transfer.commit", "harness.remote.transfer.read", "harness.remote.transfer.close", "harness.remote.stream.open", "harness.remote.stream.close", "harness.remote.compaction.submit", "harness.remote.compaction.status", "harness.remote.compaction.cancel", "loopback.call", "fileviewer.call", "codex.app.call", "codex.app.respond", "codex.app.stream.open", "codex.app.stream.close", "codex.app.transfer.open", "codex.app.transfer.chunk", "codex.app.transfer.commit", "codex.app.transfer.read", "codex.app.transfer.close", "agent.acp.call", "agent.acp.respond", "agent.acp.stream.open", "agent.acp.stream.close", "agent.acp.transfer.open", "agent.acp.transfer.chunk", "agent.acp.transfer.commit", "agent.acp.transfer.read", "agent.acp.transfer.close", "acp.initialize", "acp.session.new", "acp.session.load", "acp.session.prompt", "acp.session.respond_permission", "acp.session.cancel", "acp.session.set_mode", "plugin.route.call"];
export declare const remoteEvents: readonly ["harness.api.frame", "harness.api.stream.closed", "harness.remote.frame", "harness.remote.stream.closed", "codex.app.frame", "codex.app.stream.closed", "agent.acp.frame", "agent.acp.stream.closed", "agent.acp.catalog.changed", "acp.session.update", "acp.session.request_permission", "acp.session.closed"];
export declare const errorCodes: readonly ["INVALID_MESSAGE", "UNSUPPORTED_VERSION", "CAPABILITY_NOT_SUPPORTED", "METHOD_NOT_FOUND", "METHOD_NOT_ALLOWED", "REQUEST_CONFLICT", "FRAME_TOO_LARGE", "RATE_LIMITED", "AUTH_REQUIRED", "AUTH_INVALID", "ACCOUNT_AUTH_REQUIRED", "TOKEN_EXPIRED", "DEVICE_NOT_FOUND", "DEVICE_REVOKED", "DEVICE_OWNERSHIP_REQUIRED", "MEMBERSHIP_REQUIRED", "PEER_IDENTITY_MISMATCH", "HOST_REGISTRATION_CODE_NOT_FOUND", "HOST_REGISTRATION_CODE_EXPIRED", "HOST_REGISTRATION_CODE_CONSUMED", "HOST_OFFLINE", "CONNECTION_NOT_FOUND", "CONNECTION_FAILED", "CONNECTION_REPLACED", "P2P_FAILED", "TURN_UNAVAILABLE", "RELAY_UNAVAILABLE", "SLOW_CONSUMER", "SECURE_CHANNEL_FAILED", "HARNESS_UNAVAILABLE", "HARNESS_VERSION_INCOMPATIBLE", "RESPONSE_TOO_LARGE", "SESSION_NOT_FOUND", "SESSION_NOT_READY", "AGENT_BUSY", "PERMISSION_DENIED", "PERMISSION_NOT_PENDING", "RPC_TIMEOUT", "FULL_RESYNC_REQUIRED", "INTERNAL_ERROR"];
/**
 * Known wire-protocol error codes from §23.
 *
 * This is the authoritative reference set; callers should prefer these codes but
 * the wire format accepts any string to allow subsystem-specific extensions
 * (e.g. CODEX_*, FILE_VIEWER_*) without a protocol version bump.
 */
export type ErrorCode = typeof errorCodes[number];
export type MessageType = typeof messageTypes[number];
export type ControlFrameType = typeof controlFrameTypes[number];
export type RpcMethod = typeof rpcMethods[number];
export type RemoteEventName = typeof remoteEvents[number];
export interface HostDeviceDescriptor {
    deviceId: string;
    name: string;
    role: 'host';
    platform: string;
    identityKey: string;
    clientVersion: string;
    harnessVersion?: string;
}
export interface ClientDeviceDescriptor {
    deviceId: string;
    name: string;
    role: 'client';
    platform: string;
    identityKey: string;
    clientVersion: string;
}
export type AccountDeviceDescriptor = HostDeviceDescriptor | ClientDeviceDescriptor;
export interface DeviceRegistrationRequest {
    v: typeof PROTOCOL_VERSION;
    device: AccountDeviceDescriptor;
}
export interface HostRegistrationCodeRequest {
    v: typeof PROTOCOL_VERSION;
    code: string;
    device: HostDeviceDescriptor;
}
export interface DeviceRefreshRequest {
    deviceId: string;
    refreshToken: string;
}
export interface DeviceTokenPair {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
}
export interface BrowserAuthorizationExchangeRequest {
    v: typeof PROTOCOL_VERSION;
    device: ClientDeviceDescriptor & {
        platform: 'browser';
    };
}
export interface BrowserAuthorizationExchangeResponse extends DeviceTokenPair {
    account: string;
}
export interface ControlFrame<TPayload = unknown> {
    v: typeof PROTOCOL_VERSION;
    id: string;
    type: ControlFrameType;
    timestamp: number;
    payload: TPayload;
}
/** Envelope used by the independent Relay data WebSocket. */
export interface RelayDataFrame<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    v: typeof PROTOCOL_VERSION;
    id: string;
    type: string;
    timestamp: number;
    payload: TPayload;
}
export interface ControlFrameByteLimits {
    maxControlFrameBytes?: number;
    maxRelayFrameBytes?: number;
}
export interface HelloPayload {
    recoveryTickets?: string[];
    role: 'host' | 'client';
    deviceId: string;
    accessToken: string;
    protocols: number[];
    capabilities: string[];
    /** Version of the Client/Plugin software reporting in; symmetric to ``HelloAckPayload.serverVersion``. */
    clientVersion?: string;
    /** Host Harness version; sent on first hello to refresh the device record. */
    harnessVersion?: string;
}
export interface HelloAckPayload {
    protocol: typeof PROTOCOL_VERSION;
    serverVersion: string;
    connectionSessionId: string;
    heartbeatIntervalMs: number;
    maxControlFrameBytes: number;
    maxRelayFrameBytes: number;
    capabilities?: string[];
    /** Optional implementation extension. This field reports WebRTC DataChannel support. */
    webrtcEnabled?: boolean;
    /** Optional implementation extension. This field sets the Relay fallback timeout. */
    webrtcFallbackTimeoutMs?: number;
}
export interface ConnectRequestPayload {
    hostDeviceId: string;
    preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>;
}
export interface ConnectIncomingPayload {
    relayRecoveryTicket?: string;
    recoveryTicket?: string;
    connectionId: string;
    clientDeviceId: string;
    clientIdentityKey: string;
    authorization: 'account';
    preferredTransports: Array<'lan' | 'p2p' | 'turn' | 'relay'>;
    /** Optional independent Relay data-plane assignment. */
    relayEndpoint?: string;
    relayTicket?: string;
    relayNodeId?: string;
    relayEpoch?: number;
}
export interface ConnectAcceptedPayload {
    relayRecoveryTicket?: string;
    recoveryTicket?: string;
    connectionId: string;
    /** Optional independent Relay data-plane assignment. */
    relayEndpoint?: string;
    relayTicket?: string;
    relayNodeId?: string;
    relayEpoch?: number;
}
export interface ConnectRejectedPayload {
    connectionId: string;
    code?: string;
    message?: string;
}
export interface SecureHandshakePayload {
    connectionId: string;
    targetDeviceId: string;
    step: number;
    data: string;
}
export interface ControlErrorPayload {
    /** §23 defines standard codes. Subsystems can add names such as CODEX_* and FILE_VIEWER_*. */
    code: ErrorCode | (string & {});
    message: string;
    retryable?: boolean;
    connectionId?: string;
}
export interface RelayPayload {
    connectionId: string;
    targetDeviceId: string;
    counter: number;
    ciphertext: string;
}
export declare const selectedTransports: readonly ["lan", "p2p", "turn", "relay"];
export type SelectedTransport = typeof selectedTransports[number];
export interface SignalPayload {
    connectionId: string;
    targetDeviceId: string;
    sdp: string;
}
export interface IceCandidatePayload {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
}
export interface SignalIcePayload {
    connectionId: string;
    targetDeviceId: string;
    candidate: IceCandidatePayload;
}
export declare function normalizeSdpMLineIndex(value: unknown): number | null | undefined;
export interface TransportSelectedPayload {
    connectionId: string;
    targetDeviceId: string;
    transport: SelectedTransport;
    /** Relay hostname the client actually used when transport is "turn"
     *  (best-effort, from ICE stats; absent for other transports). */
    turnNode?: string;
}
/** Capabilities both ends announce in ``hello`` to negotiate the data plane. */
export declare const transportCapabilities: readonly ["transport.lan", "transport.p2p", "transport.turn", "transport.relay"];
/**
 * Universe of known harness/transfer/file-viewer/codex capability values (§17).
 *
 * This is a reference set for type checking and validation, NOT a capability
 * set that a Host may advertise wholesale.  A Typert Host must advertise only
 * the capability matching its Session generation (harness.remote.v1 XOR
 * harness.remote.v3); advertising both is a protocol violation.
 */
export declare const harnessCapabilityValues: readonly ["remote.history.compact.v1", "remote.compaction.async.v1", "workspace.upload.v1", "harness.api.v1", "harness.api.transfer.v1", "harness.remote.v1", "harness.remote.v3", "harness.remote.transfer.v1", "harness.remote.stream.transfer.v1", "fileviewer.read.v1", "codex.appserver.v1", "codex.appserver.transfer.v1", "plugin.route.v1"];
export type TransportCapability = typeof transportCapabilities[number];
export type HarnessCapabilityValue = typeof harnessCapabilityValues[number];
export declare function selectProtocolVersion(offered: readonly number[], supported?: readonly number[]): number | undefined;
export declare function selectCapabilities(offered: readonly string[], supported: readonly string[]): string[];
export declare function acceptNegotiatedCapabilities(offered: readonly string[], negotiated: readonly string[] | undefined): string[];
export interface RemoteMessage<TPayload = unknown> {
    v: typeof PROTOCOL_VERSION;
    id: string;
    type: MessageType;
    timestamp: number;
    payload: TPayload;
}
export interface RpcRequestPayload<TParams = unknown> {
    method: RpcMethod;
    params: TParams;
}
export type AcpBackend = 'cursor' | 'claude' | 'opencode' | 'pi' | 'hermes' | 'antigravity' | (string & {});
export interface AcpInitializeParams {
    protocolVersion: 1;
    backend?: AcpBackend;
}
export interface AcpInitializeResult {
    protocolVersion: 1;
    capability: typeof ACP_CAPABILITY;
    backend: AcpBackend;
    capabilities: string[];
    availableBackends?: AcpBackend[];
}
export interface AcpSessionParams {
    sessionId?: string;
    cwd?: string;
    mode?: string;
    backend?: AcpBackend;
}
export interface AcpPromptParams {
    sessionId: string;
    prompt: string;
    images?: Array<{
        mimeType: string;
        data: string;
    }>;
}
export interface AcpPermissionResponseParams {
    sessionId: string;
    requestId: string;
    decision: 'allow_once' | 'deny';
}
export interface AcpCancelParams {
    sessionId: string;
}
export interface AcpSetModeParams {
    sessionId: string;
    mode: string;
}
export interface AcpSessionUpdate {
    sessionId: string;
    update: unknown;
    seq: number;
}
export interface RpcResponsePayload<TResult = unknown> {
    requestId: string;
    result: TResult;
}
export interface RpcErrorPayload {
    requestId: string;
    /** §23 defines standard codes. Subsystems can add names such as CODEX_* and FILE_VIEWER_*. */
    code: ErrorCode | (string & {});
    message: string;
    retryable?: boolean;
    details?: unknown;
}
export interface EventPayload<TData = unknown> {
    seq?: number;
    event: RemoteEventName;
    sessionId?: string;
    data: TData;
}
export interface DeviceDescriptor {
    deviceId: string;
    name: string;
    role: 'host' | 'client';
    platform: string;
    identityKey: string;
    clientVersion: string;
    harnessVersion?: string;
}
export interface TransportStats {
    mode: 'LAN' | 'P2P' | 'TURN' | 'Relay' | 'Disconnected';
    connected: boolean;
    rttMs?: number;
    bytesSent?: number;
    bytesReceived?: number;
}
/** Local plugin web route call tunneled inside the authenticated business channel. */
export interface PluginRouteCallParams {
    route: string;
    body: {
        endpoint: string;
        payload?: Record<string, unknown> | null;
    };
}
export interface PluginRouteCallResult {
    status: number;
    json: unknown;
}
/** Native Harness API request tunneled inside the authenticated business channel. */
export interface HarnessApiCallParams {
    method: string;
    rpcId: string;
    payload: unknown;
}
export interface HarnessApiTransferOpenParams {
    transferId: string;
    totalBytes: number;
    totalChunks: number;
}
export interface HarnessApiTransferChunkParams {
    transferId: string;
    index: number;
    data: string;
}
export interface HarnessApiTransferCommitParams {
    transferId: string;
}
export interface HarnessApiTransferReadParams {
    transferId: string;
    index: number;
}
export interface HarnessApiTransferCloseParams {
    transferId: string;
}
export type HarnessApiTransferCommitResult = {
    kind: 'inline';
    response: unknown;
} | {
    kind: 'chunked';
    transferId: string;
    totalBytes: number;
    totalChunks: number;
};
export interface HarnessApiTransferReadResult {
    transferId: string;
    index: number;
    data: string;
}
/** Response to an answerable native Harness server request (approval/question). */
export interface HarnessApiRespondParams {
    message: {
        type: 'client-response';
        rpcId: string;
        result: unknown;
    };
}
export interface HarnessApiStreamOpenParams {
    streamId: string;
    stream: 'mux' | 'host';
    rpcId: string;
    payload: {
        /** Optional mux focus: only forward frames for this session. */
        sessionId?: string;
    };
}
export interface HarnessApiStreamCloseParams {
    streamId: string;
}
export interface HarnessApiFrameData {
    streamId: string;
    frame: {
        rpcId: string;
        payload: unknown;
    };
}
export interface HarnessApiStreamClosedData {
    streamId: string;
    reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected';
}
/** Alpha Typert Remote carrier request after the local Gateway encoded it. */
export interface HarnessRemoteCallParams {
    endpoint: string;
    payload: unknown;
}
export interface HarnessRemoteStreamOpenParams {
    streamId: string;
    endpoint: string;
    payload: unknown;
    /** Opt in only after the Host advertises harness.remote.stream.transfer.v1. */
    transferFrames?: boolean;
}
export interface HarnessRemoteStreamCloseParams {
    streamId: string;
}
export interface HarnessRemoteFrameData {
    streamId: string;
    hasValue: true;
    value?: unknown;
    /** Mutually exclusive with value; reads reconstruct the complete original frame. */
    transfer?: Extract<HarnessApiTransferCommitResult, {
        kind: 'chunked';
    }>;
}
export interface HarnessRemoteStreamClosedData {
    streamId: string;
    reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected';
    failure?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
/**
 * Remote-owned asynchronous compaction contract.
 *
 * Harness `commands/execute('/compact')` legitimately waits for the whole
 * summarization, which can take minutes on slow local inference backends. The
 * Remote bridge therefore registers the operation on the Host and returns
 * immediately; the command keeps running on the Host runtime even when the
 * submitting client disconnects. Clients observe the operation through
 * `harness.remote.compaction.status` and the ordinary Session event stream.
 *
 * Every result is settled by the Host's own background call: a
 * `compaction/end` event never fabricates success.
 */
export declare const REMOTE_COMPACTION_CAPABILITY = "remote.compaction.async.v1";
/** Operation states visible to Remote clients. */
export type RemoteCompactionState = 'accepted' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
/** The run committed, but cancellation/timing hid the final persistence result. */
 | 'unconfirmed';
export interface RemoteCompactionSubmitParams {
    sessionId: string;
    /** Client-chosen idempotency key; retrying the same id never starts a second run. */
    requestId: string;
    /**
     * Wall-clock budget for the compaction task itself, independent of any RPC
     * deadline. Hosts clamp it to [60_000, 7_200_000]; the default is 30 minutes.
     */
    budgetMs?: number;
}
export interface RemoteCompactionSubmitResult {
    operationId: string;
    state: RemoteCompactionState;
}
export interface RemoteCompactionStatusParams {
    sessionId: string;
    operationId: string;
}
export interface RemoteCompactionStatusResult {
    operationId: string;
    sessionId: string;
    state: RemoteCompactionState;
    /** Epoch ms when the Host accepted the operation; absent when the Host lost it. */
    acceptedAt?: number;
    startedAt?: number;
    finishedAt?: number;
    /** Human-readable outcome detail; never a substituted success. */
    message?: string;
}
export interface RemoteWorkspaceTypeDescription {
    id: string;
    name: string;
    capability: string;
    available: boolean;
}
/** Read-only history delivery preference, scoped to one authenticated connection. */
export interface RemoteHistoryConfigureParams {
    compact: boolean;
}
export interface HarnessTransportDescription {
    capabilities: string[];
    workspaceTypes?: RemoteWorkspaceTypeDescription[];
}
export type CodexPermissionPreset = 'workspace-write' | 'danger-full-access';
/** Optional dsh/sessionHistory metadata; null means the Host has no confirmed preset. */
export interface CodexPermissionSnapshot {
    permissionPreset?: CodexPermissionPreset | null;
}
/** Fixed allowlisted Codex App Server call carried inside Remote. */
export interface CodexAppCallParams {
    method: string;
    params: unknown;
}
export interface CodexAppRespondParams {
    requestHandle: string;
    decision: 'accept' | 'decline' | 'cancel';
}
export interface CodexAppStreamOpenParams {
    streamId: string;
    threadId: string;
}
export interface CodexAppStreamCloseParams {
    streamId: string;
}
export interface CodexAppFrameData {
    streamId: string;
    frame: {
        method: string;
        params: unknown;
    };
}
export interface CodexAppStreamClosedData {
    streamId: string;
    reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected';
}
export interface CodexAppTransferOpenParams {
    transferId: string;
    totalBytes: number;
    totalChunks: number;
}
export interface CodexAppTransferChunkParams {
    transferId: string;
    index: number;
    data: string;
}
export interface CodexAppTransferCommitParams {
    transferId: string;
}
export interface CodexAppTransferReadParams {
    transferId: string;
    index: number;
}
export interface CodexAppTransferCloseParams {
    transferId: string;
}
export type CodexAppTransferCommitResult = {
    kind: 'inline';
    response: unknown;
} | {
    kind: 'chunked';
    transferId: string;
    totalBytes: number;
    totalChunks: number;
};
export interface CodexAppTransferReadResult {
    transferId: string;
    index: number;
    data: string;
}
/** Fixed allowlisted Agent ACP call carried inside Remote. */
export interface AgentAcpCallParams {
    method: string;
    params: unknown;
}
export interface AcpSessionArchivedData {
    backend: 'opencode';
    sessionId: string;
    archived: true;
}
export interface AgentAcpRespondParams {
    requestHandle: string;
    decision: 'allow-once' | 'reject-once' | 'cancel';
    /** Optional structured answer for backend extension methods (ask_question / create_plan). */
    result?: unknown;
}
export type AcpWorkspaceToolCallEndpoint = 'workspaceFiles/list' | 'workspaceFiles/stat' | 'workspaceFiles/read' | 'workspaceFiles/readBytes' | 'workspaceFiles/readAll' | 'terminal/environment' | 'terminal/shells' | 'terminal/list' | 'terminal/create' | 'terminal/write' | 'terminal/resize' | 'terminal/rename' | 'terminal/close';
export type AcpWorkspaceToolStreamEndpoint = 'workspaceFiles/changes' | 'terminal/follow' | 'terminal/retain';
export interface AcpWorkspaceToolParams {
    sessionId: string;
    backend: 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes';
    endpoint: AcpWorkspaceToolCallEndpoint;
    args: Record<string, unknown>;
}
export interface AcpModelParams {
    sessionId: string;
    backend: 'cursor' | 'claude' | 'antigravity' | 'pi' | 'opencode';
}
export interface AcpModelSelectionParams extends AcpModelParams {
    model: string;
    reasoningEffort?: string;
}
export interface AgentAcpStreamOpenParams {
    streamId: string;
    sessionId: string;
    tool?: {
        backend: 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes';
        endpoint: AcpWorkspaceToolStreamEndpoint;
        args: Record<string, unknown>;
    };
}
export interface AgentAcpStreamCloseParams {
    streamId: string;
}
export interface AgentAcpFrameData {
    streamId: string;
    frame: {
        method: string;
        params: unknown;
    };
}
export interface AgentAcpStreamClosedData {
    streamId: string;
    reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected';
}
export interface AgentAcpTransferOpenParams {
    transferId: string;
    totalBytes: number;
    totalChunks: number;
}
export interface AgentAcpTransferChunkParams {
    transferId: string;
    index: number;
    data: string;
}
export interface AgentAcpTransferCommitParams {
    transferId: string;
}
export interface AgentAcpTransferReadParams {
    transferId: string;
    index: number;
}
export interface AgentAcpTransferCloseParams {
    transferId: string;
}
export type AgentAcpTransferCommitResult = {
    kind: 'inline';
    response: unknown;
} | {
    kind: 'chunked';
    transferId: string;
    totalBytes: number;
    totalChunks: number;
};
export interface AgentAcpTransferReadResult {
    transferId: string;
    index: number;
    data: string;
}
export declare const errorCodeSchema: z.ZodEnum<{
    CONNECTION_FAILED: "CONNECTION_FAILED";
    INVALID_MESSAGE: "INVALID_MESSAGE";
    UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION";
    CAPABILITY_NOT_SUPPORTED: "CAPABILITY_NOT_SUPPORTED";
    METHOD_NOT_FOUND: "METHOD_NOT_FOUND";
    METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED";
    REQUEST_CONFLICT: "REQUEST_CONFLICT";
    FRAME_TOO_LARGE: "FRAME_TOO_LARGE";
    RATE_LIMITED: "RATE_LIMITED";
    AUTH_REQUIRED: "AUTH_REQUIRED";
    AUTH_INVALID: "AUTH_INVALID";
    ACCOUNT_AUTH_REQUIRED: "ACCOUNT_AUTH_REQUIRED";
    TOKEN_EXPIRED: "TOKEN_EXPIRED";
    DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND";
    DEVICE_REVOKED: "DEVICE_REVOKED";
    DEVICE_OWNERSHIP_REQUIRED: "DEVICE_OWNERSHIP_REQUIRED";
    MEMBERSHIP_REQUIRED: "MEMBERSHIP_REQUIRED";
    PEER_IDENTITY_MISMATCH: "PEER_IDENTITY_MISMATCH";
    HOST_REGISTRATION_CODE_NOT_FOUND: "HOST_REGISTRATION_CODE_NOT_FOUND";
    HOST_REGISTRATION_CODE_EXPIRED: "HOST_REGISTRATION_CODE_EXPIRED";
    HOST_REGISTRATION_CODE_CONSUMED: "HOST_REGISTRATION_CODE_CONSUMED";
    HOST_OFFLINE: "HOST_OFFLINE";
    CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND";
    CONNECTION_REPLACED: "CONNECTION_REPLACED";
    P2P_FAILED: "P2P_FAILED";
    TURN_UNAVAILABLE: "TURN_UNAVAILABLE";
    RELAY_UNAVAILABLE: "RELAY_UNAVAILABLE";
    SLOW_CONSUMER: "SLOW_CONSUMER";
    SECURE_CHANNEL_FAILED: "SECURE_CHANNEL_FAILED";
    HARNESS_UNAVAILABLE: "HARNESS_UNAVAILABLE";
    HARNESS_VERSION_INCOMPATIBLE: "HARNESS_VERSION_INCOMPATIBLE";
    RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE";
    SESSION_NOT_FOUND: "SESSION_NOT_FOUND";
    SESSION_NOT_READY: "SESSION_NOT_READY";
    AGENT_BUSY: "AGENT_BUSY";
    PERMISSION_DENIED: "PERMISSION_DENIED";
    PERMISSION_NOT_PENDING: "PERMISSION_NOT_PENDING";
    RPC_TIMEOUT: "RPC_TIMEOUT";
    FULL_RESYNC_REQUIRED: "FULL_RESYNC_REQUIRED";
    INTERNAL_ERROR: "INTERNAL_ERROR";
}>;
export declare const hostDeviceDescriptorSchema: z.ZodType<HostDeviceDescriptor>;
export declare const clientDeviceDescriptorSchema: z.ZodType<ClientDeviceDescriptor>;
export declare const accountDeviceDescriptorSchema: z.ZodType<AccountDeviceDescriptor>;
export declare const deviceRegistrationRequestSchema: z.ZodType<DeviceRegistrationRequest>;
export declare const hostRegistrationCodeRequestSchema: z.ZodType<HostRegistrationCodeRequest>;
/** §8.1.2 Register a new opposite-role device using an existing device access token. */
export interface RegisterOwnedRoleRequest {
    v: typeof PROTOCOL_VERSION;
    device: AccountDeviceDescriptor;
}
export declare const registerOwnedRoleRequestSchema: z.ZodType<RegisterOwnedRoleRequest>;
export declare const deviceRefreshRequestSchema: z.ZodType<DeviceRefreshRequest>;
export declare const deviceTokenPairSchema: z.ZodType<DeviceTokenPair>;
export declare const browserAuthorizationExchangeRequestSchema: z.ZodType<BrowserAuthorizationExchangeRequest>;
export declare const browserAuthorizationExchangeResponseSchema: z.ZodType<BrowserAuthorizationExchangeResponse>;
export declare const remoteMessageSchema: z.ZodType<RemoteMessage>;
export declare const controlFrameSchema: z.ZodType<ControlFrame>;
export declare const relayDataFrameSchema: z.ZodType<RelayDataFrame>;
export declare const helloPayloadSchema: z.ZodObject<{
    recoveryTickets: z.ZodOptional<z.ZodArray<z.ZodString>>;
    role: z.ZodEnum<{
        host: "host";
        client: "client";
    }>;
    deviceId: z.ZodString;
    accessToken: z.ZodString;
    protocols: z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodNumber>>;
    capabilities: z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodString>>;
    clientVersion: z.ZodOptional<z.ZodString>;
    harnessVersion: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const helloAckPayloadSchema: z.ZodObject<{
    protocol: z.ZodLiteral<1>;
    serverVersion: z.ZodString;
    connectionSessionId: z.ZodString;
    heartbeatIntervalMs: z.ZodNumber;
    maxControlFrameBytes: z.ZodNumber;
    maxRelayFrameBytes: z.ZodNumber;
    capabilities: z.ZodOptional<z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodString>>>;
    webrtcEnabled: z.ZodOptional<z.ZodBoolean>;
    webrtcFallbackTimeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const remoteWorkspaceTypeDescriptionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    capability: z.ZodString;
    available: z.ZodBoolean;
}, z.core.$strip>;
export declare const harnessTransportDescriptionSchema: z.ZodObject<{
    capabilities: z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodString>>;
    workspaceTypes: z.ZodOptional<z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        capability: z.ZodString;
        available: z.ZodBoolean;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
export declare function parseRemoteWorkspaceTypes(value: unknown): RemoteWorkspaceTypeDescription[];
export declare const connectRequestPayloadSchema: z.ZodObject<{
    hostDeviceId: z.ZodString;
    preferredTransports: z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodEnum<{
        relay: "relay";
        lan: "lan";
        p2p: "p2p";
        turn: "turn";
    }>>>;
}, z.core.$strip>;
export declare const connectIncomingPayloadSchema: z.ZodObject<{
    relayRecoveryTicket: z.ZodOptional<z.ZodString>;
    recoveryTicket: z.ZodOptional<z.ZodString>;
    connectionId: z.ZodString;
    clientDeviceId: z.ZodString;
    clientIdentityKey: z.ZodString;
    authorization: z.ZodLiteral<"account">;
    preferredTransports: z.ZodPipe<z.ZodArray<z.ZodUnknown>, z.ZodArray<z.ZodEnum<{
        relay: "relay";
        lan: "lan";
        p2p: "p2p";
        turn: "turn";
    }>>>;
    relayEndpoint: z.ZodOptional<z.ZodString>;
    relayTicket: z.ZodOptional<z.ZodString>;
    relayNodeId: z.ZodOptional<z.ZodString>;
    relayEpoch: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const connectAcceptedPayloadSchema: z.ZodObject<{
    relayRecoveryTicket: z.ZodOptional<z.ZodString>;
    recoveryTicket: z.ZodOptional<z.ZodString>;
    connectionId: z.ZodString;
    relayEndpoint: z.ZodOptional<z.ZodString>;
    relayTicket: z.ZodOptional<z.ZodString>;
    relayNodeId: z.ZodOptional<z.ZodString>;
    relayEpoch: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const connectRejectedPayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const secureHandshakePayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    targetDeviceId: z.ZodString;
    step: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
    data: z.ZodString;
}, z.core.$strip>;
export declare const relayPayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    targetDeviceId: z.ZodString;
    counter: z.ZodNumber;
    ciphertext: z.ZodString;
}, z.core.$strip>;
export declare const signalPayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    targetDeviceId: z.ZodString;
    sdp: z.ZodString;
}, z.core.$strip>;
export declare const signalIcePayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    targetDeviceId: z.ZodString;
    candidate: z.ZodObject<{
        candidate: z.ZodOptional<z.ZodString>;
        sdpMid: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        sdpMLineIndex: z.ZodPreprocess<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, unknown>;
        usernameFragment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const transportSelectedPayloadSchema: z.ZodObject<{
    connectionId: z.ZodString;
    targetDeviceId: z.ZodString;
    transport: z.ZodEnum<{
        relay: "relay";
        lan: "lan";
        p2p: "p2p";
        turn: "turn";
    }>;
    turnNode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const pingPongPayloadSchema: z.ZodObject<{
    nonce: z.ZodString;
}, z.core.$strip>;
export declare const controlErrorPayloadSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    retryable: z.ZodOptional<z.ZodBoolean>;
    connectionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const connectionLeaseRequestSchema: z.ZodObject<{
    connectionId: z.ZodString;
    requestId: z.ZodString;
    ticket: z.ZodString;
}, z.core.$strip>;
export declare const connectionLeaseAckSchema: z.ZodObject<{
    connectionId: z.ZodString;
    requestId: z.ZodString;
    ticket: z.ZodString;
    leaseMs: z.ZodLiteral<300000>;
}, z.core.$strip>;
export type ConnectionLeaseAck = z.infer<typeof connectionLeaseAckSchema>;
export declare const rpcRequestPayloadSchema: z.ZodType<RpcRequestPayload>;
export declare const rpcResponsePayloadSchema: z.ZodType<RpcResponsePayload>;
export declare const rpcErrorPayloadSchema: z.ZodType<RpcErrorPayload>;
export declare function createMessage<TPayload>(type: MessageType, payload: TPayload, id?: string): RemoteMessage<TPayload>;
export declare function createControlFrame<TPayload>(type: ControlFrameType, payload: TPayload, id?: string): ControlFrame<TPayload>;
export declare function createRelayDataFrame<TPayload extends Record<string, unknown>>(type: string, payload: TPayload, id?: string): RelayDataFrame<TPayload>;
export declare function createRpcRequest<TParams>(method: RpcMethod, params: TParams, id?: string): RemoteMessage<RpcRequestPayload<TParams>>;
export declare function createRpcResponse<TResult>(requestId: string, result: TResult): RemoteMessage<RpcResponsePayload<TResult>>;
export declare function createRpcError(requestId: string, code: ErrorCode | (string & {}), message: string, details?: unknown, retryable?: boolean): RemoteMessage<RpcErrorPayload>;
export declare function createEvent<TData>(event: RemoteEventName, data: TData, options?: {
    seq?: number;
    sessionId?: string;
}): RemoteMessage<EventPayload<TData>>;
export declare function parseRemoteMessage(input: unknown): RemoteMessage;
export declare function parseControlFrame(input: unknown): ControlFrame;
export declare function encodeControlFrame(frame: ControlFrame, limits?: ControlFrameByteLimits): string;
export declare function decodeControlFrame(data: Uint8Array | string, limits?: ControlFrameByteLimits): ControlFrame;
export declare function encodeRelayDataFrame(frame: RelayDataFrame, limits?: ControlFrameByteLimits): string;
export declare function decodeRelayDataFrame(data: Uint8Array | string, limits?: ControlFrameByteLimits): RelayDataFrame;
export declare function encodeMessage(message: RemoteMessage): Uint8Array;
export declare function decodeMessage(data: Uint8Array | string): RemoteMessage;
/**
 * Splits application plaintext before Noise encryption and reassembles it
 * after decryption. Noise transport messages have a 65,535-byte ceiling, so
 * large native ApiProxy responses cannot be encrypted as one message.
 */
export declare class SecureMessageCodec {
    private nextMessageId;
    private readonly assemblies;
    encode(message: Uint8Array): Uint8Array[];
    decode(frame: Uint8Array): Uint8Array | undefined;
    reset(): void;
}
