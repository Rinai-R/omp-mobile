export * from './loopback.js';
import { parseWireJson } from './wire-json.js';
export { parseWireJson } from './wire-json.js';
import { z } from 'zod';
export const WEBRTC_RESUME_CAPABILITY = 'transport.webrtc.resume.v1';
export const RELAY_RESUME_CAPABILITY = 'transport.relay.resume.v1';
export const WEBRTC_LEASE_MS = 300_000;
import { SERVER_SHUTDOWN_REASON as SERVER_SHUTDOWN_REASON_NAME } from './close-semantics.js';
export { SERVER_SHUTDOWN_REASON, SERVER_SHUTDOWN_CLOSE_CODES, HEARTBEAT_TIMEOUT_CLOSE_CODE, HEARTBEAT_TIMEOUT_REASON, HEARTBEAT_CONNECTION_FAILED_REASON, TRANSIENT_CONTROL_CLOSE_CODES, TERMINAL_CONTROL_CLOSE_CODES, isServerShutdownClose, isHeartbeatTimeoutClose, classifyControlClose, } from './close-semantics.js';
/**
 * WebSocket close code a Server uses when shutting down for restart.
 *
 * Deployments disagree on the code (`apps/server` sends 4009, the hosted
 * Server sends 4001 and reserves 4009 for heartbeat expiry), so endpoints must
 * classify with `isServerShutdownClose()` / `classifyControlClose()` and never
 * by comparing the code alone.
 */
export const SERVER_SHUTDOWN_CLOSE_CODE = 4009;
/** Close reason paired with the shutdown code; this is the semantic key. */
export const SERVER_SHUTDOWN_CLOSE_REASON = SERVER_SHUTDOWN_REASON_NAME;
export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024;
export const MAX_RELAY_FRAME_BYTES = 1024 * 1024;
export const SECURE_FRAGMENT_CHUNK_BYTES = 48 * 1024;
export const MAX_SECURE_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Decoded bytes carried by one authenticated Harness business transfer chunk. */
export const HARNESS_API_TRANSFER_CHUNK_BYTES = 512 * 1024;
/** Decoded bytes carried by one authenticated Codex domain transfer chunk. */
export const CODEX_APP_TRANSFER_CHUNK_BYTES = 512 * 1024;
/** Decoded bytes carried by one authenticated Agent ACP domain transfer chunk. */
export const AGENT_ACP_TRANSFER_CHUNK_BYTES = 512 * 1024;
/**
 * Bounded transfer size for Harness image prompts. The upstream default admits
 * up to 200 MiB of source images; their base64 JSON envelope needs roughly
 * 267 MiB, so 288 MiB leaves room for the native request structure.
 */
export const MAX_HARNESS_API_TRANSFER_BYTES = 288 * 1024 * 1024;
export const MAX_CODEX_APP_TRANSFER_BYTES = 288 * 1024 * 1024;
export const MAX_AGENT_ACP_TRANSFER_BYTES = 288 * 1024 * 1024;
export const MAX_DEVICE_NAME_LENGTH = 128;
export const MAX_DEVICE_PLATFORM_LENGTH = 64;
export const MAX_DEVICE_VERSION_LENGTH = 64;
export const MAX_AUTH_TOKEN_LENGTH = 8 * 1024;
/** Maximum entries accepted in capability and workspace type advertisements. */
export const MAX_REMOTE_CAPABILITY_ENTRIES = 128;
export const MAX_REMOTE_WORKSPACE_TYPE_ENTRIES = 32;
// ────────────────────────────────────────────────────────────────────────────
// §24 Default limits
// ────────────────────────────────────────────────────────────────────────────
/** Hello frame must arrive within this timeout after WebSocket open. */
export const HELLO_TIMEOUT_MS = 5_000;
/** Host registration code time-to-live. */
export const HOST_REGISTRATION_CODE_TTL_MS = 10 * 60_000;
/** Default control channel heartbeat interval. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
/** Disconnection threshold: no valid pong within this window. */
export const HEARTBEAT_DISCONNECT_MS = 75_000;
/** Maximum in-flight RPC requests per connection. */
export const MAX_PENDING_RPC_PER_CONNECTION = 128;
/** Maximum pending permission requests per session. */
export const MAX_PENDING_PERMISSION_PER_SESSION = 16;
/** Maximum ICE candidates收集 per connection. */
export const MAX_ICE_CANDIDATES_PER_CONNECTION = 256;
/** Maximum active transfers per direction per connection. */
export const MAX_ACTIVE_TRANSFERS_PER_DIRECTION = 2;
/** Transfer idle timeout before automatic cleanup. */
export const TRANSFER_IDLE_MS = 2 * 60_000;
/** Maximum RPC text input size. */
export const MAX_RPC_TEXT_INPUT_BYTES = 64 * 1024;
/** Maximum File Viewer range per RPC call. */
export const MAX_FILEVIEWER_RANGE_BYTES = 512 * 1024;
/** Maximum directory entries returned by File Viewer per RPC. */
export const MAX_FILEVIEWER_DIRECTORY_ENTRIES = 1_000;
/** Minimum event replay window by event count. */
export const MIN_REPLAY_WINDOW_EVENTS = 10_000;
/** Minimum event replay window by time. */
export const MIN_REPLAY_WINDOW_MS = 15 * 60_000;
/** Maximum concurrent alpha streams per connection. */
export const MAX_ALPHA_STREAMS_PER_CONNECTION = 16;
/** Generic Agent Client Protocol capability and bounded gateway limits. */
export const ACP_CAPABILITY = 'agent.acp.v1';
export const ACP_PI_CAPABILITY = 'agent.acp.pi.v1';
export const ACP_WORKSPACE_FILES_CAPABILITY = 'agent.acp.workspace-files.v1';
export const ACP_TERMINAL_CAPABILITY = 'agent.acp.terminal.v1';
export const ACP_ANTIGRAVITY_MODELS_CAPABILITY = 'agent.acp.antigravity.models.v1';
export const ACP_ANTIGRAVITY_MODEL_LOAD_CAPABILITY = 'agent.acp.antigravity.model-load.v1';
export const ACP_OPENCODE_CAPABILITY = 'agent.acp.opencode.v1';
export const ACP_OPENCODE_ARCHIVE_CAPABILITY = 'agent.acp.opencode.archive.v1';
export const ACP_TOOL_CALL_ENDPOINTS = ['workspaceFiles/list', 'workspaceFiles/stat', 'workspaceFiles/read', 'workspaceFiles/readBytes', 'workspaceFiles/readAll',
    'terminal/environment', 'terminal/shells', 'terminal/list', 'terminal/create', 'terminal/write', 'terminal/resize', 'terminal/rename', 'terminal/close'];
export const ACP_TOOL_STREAM_ENDPOINTS = ['workspaceFiles/changes', 'terminal/follow', 'terminal/retain'];
export const MAX_ACP_PROMPT_BYTES = 64 * 1024;
export const MAX_ACP_UPDATE_BYTES = 512 * 1024;
const SECURE_FRAGMENT_MAGIC = new Uint8Array([0x44, 0x53, 0x48, 0x46]); // DSHF
const SECURE_FRAGMENT_VERSION = 1;
const SECURE_FRAGMENT_HEADER_BYTES = 17;
const MAX_IN_FLIGHT_SECURE_MESSAGES = 8;
export const messageTypes = [
    'rpc.request',
    'rpc.response',
    'rpc.error',
    'event',
];
export const controlFrameTypes = [
    'hello',
    'hello.ack',
    'connect.request',
    'connect.incoming',
    'connect.accepted',
    'connect.rejected',
    'secure.handshake',
    'relay',
    'signal.offer',
    'signal.answer',
    'signal.ice',
    'transport.selected',
    'connection.lease.request',
    'connection.lease.ack',
    'connection.lease.close',
    'ping',
    'pong',
    'error',
];
export const rpcMethods = [
    'workspace.upload.open',
    'workspace.upload.chunk',
    'workspace.upload.commit',
    'workspace.upload.abort',
    'harness.transport.describe',
    'remote.history.configure',
    'harness.api.call',
    'harness.api.transfer.open',
    'harness.api.transfer.chunk',
    'harness.api.transfer.commit',
    'harness.api.transfer.read',
    'harness.api.transfer.close',
    'harness.api.respond',
    'harness.api.stream.open',
    'harness.api.stream.close',
    'harness.remote.call',
    'harness.remote.transfer.open',
    'harness.remote.transfer.chunk',
    'harness.remote.transfer.commit',
    'harness.remote.transfer.read',
    'harness.remote.transfer.close',
    'harness.remote.stream.open',
    'harness.remote.stream.close',
    'harness.remote.compaction.submit',
    'harness.remote.compaction.status',
    'harness.remote.compaction.cancel',
    'loopback.call',
    'fileviewer.call',
    'codex.app.call',
    'codex.app.respond',
    'codex.app.stream.open',
    'codex.app.stream.close',
    'codex.app.transfer.open',
    'codex.app.transfer.chunk',
    'codex.app.transfer.commit',
    'codex.app.transfer.read',
    'codex.app.transfer.close',
    'agent.acp.call',
    'agent.acp.respond',
    'agent.acp.stream.open',
    'agent.acp.stream.close',
    'agent.acp.transfer.open',
    'agent.acp.transfer.chunk',
    'agent.acp.transfer.commit',
    'agent.acp.transfer.read',
    'agent.acp.transfer.close',
    'acp.initialize',
    'acp.session.new',
    'acp.session.load',
    'acp.session.prompt',
    'acp.session.respond_permission',
    'acp.session.cancel',
    'acp.session.set_mode',
    'plugin.route.call',
];
export const remoteEvents = [
    'harness.api.frame',
    'harness.api.stream.closed',
    'harness.remote.frame',
    'harness.remote.stream.closed',
    'codex.app.frame',
    'codex.app.stream.closed',
    'agent.acp.frame',
    'agent.acp.stream.closed',
    'agent.acp.catalog.changed',
    'acp.session.update',
    'acp.session.request_permission',
    'acp.session.closed',
];
export const errorCodes = [
    // Protocol / Version
    'INVALID_MESSAGE',
    'UNSUPPORTED_VERSION',
    'CAPABILITY_NOT_SUPPORTED',
    'METHOD_NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'REQUEST_CONFLICT',
    'FRAME_TOO_LARGE',
    'RATE_LIMITED',
    // Auth / Device
    'AUTH_REQUIRED',
    'AUTH_INVALID',
    'ACCOUNT_AUTH_REQUIRED',
    'TOKEN_EXPIRED',
    'DEVICE_NOT_FOUND',
    'DEVICE_REVOKED',
    'DEVICE_OWNERSHIP_REQUIRED',
    'MEMBERSHIP_REQUIRED',
    'PEER_IDENTITY_MISMATCH',
    'HOST_REGISTRATION_CODE_NOT_FOUND',
    'HOST_REGISTRATION_CODE_EXPIRED',
    'HOST_REGISTRATION_CODE_CONSUMED',
    // Connection / Transport
    'HOST_OFFLINE',
    'CONNECTION_NOT_FOUND',
    'CONNECTION_FAILED',
    'CONNECTION_REPLACED',
    'P2P_FAILED',
    'TURN_UNAVAILABLE',
    'RELAY_UNAVAILABLE',
    'SLOW_CONSUMER',
    'SECURE_CHANNEL_FAILED',
    // Harness
    'HARNESS_UNAVAILABLE',
    'HARNESS_VERSION_INCOMPATIBLE',
    'RESPONSE_TOO_LARGE',
    'SESSION_NOT_FOUND',
    'SESSION_NOT_READY',
    'AGENT_BUSY',
    'PERMISSION_DENIED',
    'PERMISSION_NOT_PENDING',
    'RPC_TIMEOUT',
    'FULL_RESYNC_REQUIRED',
    'INTERNAL_ERROR',
];
export const selectedTransports = ['lan', 'p2p', 'turn', 'relay'];
export function normalizeSdpMLineIndex(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
        return null;
    return value;
}
/** Capabilities both ends announce in ``hello`` to negotiate the data plane. */
export const transportCapabilities = [
    'transport.lan',
    'transport.p2p',
    'transport.turn',
    'transport.relay',
];
/**
 * Universe of known harness/transfer/file-viewer/codex capability values (§17).
 *
 * This is a reference set for type checking and validation, NOT a capability
 * set that a Host may advertise wholesale.  A Typert Host must advertise only
 * the capability matching its Session generation (harness.remote.v1 XOR
 * harness.remote.v3); advertising both is a protocol violation.
 */
export const harnessCapabilityValues = [
    'remote.history.compact.v1',
    'remote.compaction.async.v1',
    'workspace.upload.v1',
    'harness.api.v1',
    'harness.api.transfer.v1',
    'harness.remote.v1',
    'harness.remote.v3',
    'harness.remote.transfer.v1',
    'harness.remote.stream.transfer.v1',
    'fileviewer.read.v1',
    'codex.appserver.v1',
    'codex.appserver.transfer.v1',
    'plugin.route.v1',
];
export function selectProtocolVersion(offered, supported = [PROTOCOL_VERSION]) {
    const supportedVersions = new Set(supported);
    return [...offered]
        .filter(version => supportedVersions.has(version))
        .sort((left, right) => right - left)[0];
}
export function selectCapabilities(offered, supported) {
    const offeredCapabilities = new Set(offered);
    return [...new Set(supported)].filter(capability => offeredCapabilities.has(capability));
}
export function acceptNegotiatedCapabilities(offered, negotiated) {
    const accepted = negotiated ?? ['transport.relay'];
    if (selectCapabilities(accepted, offered).length !== accepted.length) {
        throw new Error('Server selected a capability that the peer did not offer.');
    }
    return [...accepted];
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
export const REMOTE_COMPACTION_CAPABILITY = 'remote.compaction.async.v1';
const rpcMethodSchema = z.enum(rpcMethods);
const messageTypeSchema = z.enum(messageTypes);
const controlFrameTypeSchema = z.enum(controlFrameTypes);
export const errorCodeSchema = z.enum(errorCodes);
const uniqueStrings = (values) => new Set(values).size === values.length;
const uniqueNumbers = (values) => new Set(values).size === values.length;
const utf8Length = (value) => new TextEncoder().encode(value).byteLength;
const boundedUtf8Schema = (minimum, maximum) => z.string()
    .refine(value => utf8Length(value) >= minimum && utf8Length(value) <= maximum);
const deviceIdSchema = z.string().refine(value => (/^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)), 'Device ID must be a ULID or UUID.');
const deviceNameSchema = boundedUtf8Schema(1, MAX_DEVICE_NAME_LENGTH)
    .refine(value => value.trim().length > 0, 'Device name must contain visible text.');
const devicePlatformSchema = z.string().min(1).max(MAX_DEVICE_PLATFORM_LENGTH)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const identityKeySchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const canonicalBase64UrlSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/u).refine(value => {
    const remainder = value.length % 4;
    if (remainder === 1)
        return false;
    if (remainder === 0)
        return true;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(value.at(-1));
    return remainder === 2 ? (last & 15) === 0 : (last & 3) === 0;
}, 'Value must use canonical Base64URL without padding.');
const deviceVersionSchema = boundedUtf8Schema(1, MAX_DEVICE_VERSION_LENGTH);
const authTokenSchema = boundedUtf8Schema(16, MAX_AUTH_TOKEN_LENGTH);
const expiresAtSchema = z.number().int().positive().safe();
export const hostDeviceDescriptorSchema = z.object({
    deviceId: deviceIdSchema,
    name: deviceNameSchema,
    role: z.literal('host'),
    platform: devicePlatformSchema,
    identityKey: identityKeySchema,
    clientVersion: deviceVersionSchema,
    harnessVersion: deviceVersionSchema.optional(),
}).strict();
export const clientDeviceDescriptorSchema = z.object({
    deviceId: deviceIdSchema,
    name: deviceNameSchema,
    role: z.literal('client'),
    platform: devicePlatformSchema,
    identityKey: identityKeySchema,
    clientVersion: deviceVersionSchema,
}).strict();
export const accountDeviceDescriptorSchema = z.union([
    hostDeviceDescriptorSchema,
    clientDeviceDescriptorSchema,
]);
export const deviceRegistrationRequestSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    device: accountDeviceDescriptorSchema,
}).strict();
export const hostRegistrationCodeRequestSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
    device: hostDeviceDescriptorSchema,
}).strict();
export const registerOwnedRoleRequestSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    device: accountDeviceDescriptorSchema,
}).strict();
export const deviceRefreshRequestSchema = z.object({
    deviceId: deviceIdSchema,
    refreshToken: authTokenSchema,
}).strict();
export const deviceTokenPairSchema = z.object({
    accessToken: authTokenSchema,
    accessTokenExpiresAt: expiresAtSchema,
    refreshToken: authTokenSchema,
    refreshTokenExpiresAt: expiresAtSchema,
}).strict();
export const browserAuthorizationExchangeRequestSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    device: z.object({
        deviceId: deviceIdSchema,
        name: deviceNameSchema,
        role: z.literal('client'),
        platform: z.literal('browser'),
        identityKey: identityKeySchema,
        clientVersion: deviceVersionSchema,
    }).strict(),
}).strict();
export const browserAuthorizationExchangeResponseSchema = z.object({
    accessToken: authTokenSchema,
    accessTokenExpiresAt: expiresAtSchema,
    refreshToken: authTokenSchema,
    refreshTokenExpiresAt: expiresAtSchema,
    account: boundedUtf8Schema(1, 254).refine(value => value.trim().length > 0),
}).strict();
export const remoteMessageSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    id: z.string().min(1),
    type: messageTypeSchema,
    timestamp: z.number().int().positive(),
    payload: z.unknown(),
});
export const controlFrameSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    id: z.string().min(1),
    type: controlFrameTypeSchema,
    timestamp: z.number().int().positive(),
    payload: z.unknown(),
}).strict();
export const relayDataFrameSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    id: z.string().min(1),
    type: z.string().min(1),
    timestamp: z.number().int().positive().safe(),
    payload: z.record(z.string(), z.unknown()),
}).strict();
// ────────────────────────────────────────────────────────────────────────────
// Control frame payload schemas (protocol.md §10-§23)
// ────────────────────────────────────────────────────────────────────────────
const transportEnum = z.enum(['lan', 'p2p', 'turn', 'relay']);
const selectedTransportEnum = z.enum(selectedTransports);
const MAX_PROTOCOL_LIST_ENTRIES = 16;
const MAX_CAPABILITY_ENTRIES = MAX_REMOTE_CAPABILITY_ENTRIES;
const MAX_WORKSPACE_TYPE_ENTRIES = MAX_REMOTE_WORKSPACE_TYPE_ENTRIES;
const MAX_PREFERRED_TRANSPORT_ENTRIES = selectedTransports.length;
export const helloPayloadSchema = z.object({
    recoveryTickets: z.array(z.string().min(1).max(4096)).max(64).optional(),
    role: z.enum(['host', 'client']),
    deviceId: z.string().min(1),
    accessToken: z.string().min(1),
    protocols: z.array(z.unknown()).min(1).max(MAX_PROTOCOL_LIST_ENTRIES).pipe(z.array(z.number().int().nonnegative().safe()).refine(uniqueNumbers)),
    capabilities: z.array(z.unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(z.array(z.string().min(1)).refine(uniqueStrings)),
    clientVersion: z.string().optional(),
    harnessVersion: z.string().optional(),
});
export const helloAckPayloadSchema = z.object({
    protocol: z.literal(PROTOCOL_VERSION),
    serverVersion: z.string().min(1),
    connectionSessionId: z.string().min(1),
    heartbeatIntervalMs: z.number().int().positive().safe(),
    maxControlFrameBytes: z.number().int().positive().max(MAX_CONTROL_FRAME_BYTES),
    maxRelayFrameBytes: z.number().int().positive().max(MAX_RELAY_FRAME_BYTES),
    capabilities: z.array(z.unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(z.array(z.string().min(1)).refine(uniqueStrings)).optional(),
    webrtcEnabled: z.boolean().optional(),
    webrtcFallbackTimeoutMs: z.number().int().positive().safe().optional(),
});
export const remoteWorkspaceTypeDescriptionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    capability: z.string().min(1),
    available: z.boolean(),
});
export const harnessTransportDescriptionSchema = z.object({
    capabilities: z.array(z.unknown()).max(MAX_CAPABILITY_ENTRIES).pipe(z.array(z.string().min(1)).refine(uniqueStrings)),
    workspaceTypes: z.array(z.unknown()).max(MAX_WORKSPACE_TYPE_ENTRIES).pipe(z.array(remoteWorkspaceTypeDescriptionSchema)).optional(),
});
export function parseRemoteWorkspaceTypes(value) {
    if (!Array.isArray(value))
        return [];
    if (value.length > MAX_WORKSPACE_TYPE_ENTRIES)
        return [];
    const types = [];
    for (const item of value) {
        const result = remoteWorkspaceTypeDescriptionSchema.safeParse(item);
        if (result.success) {
            types.push(result.data);
        }
    }
    return types;
}
export const connectRequestPayloadSchema = z.object({
    hostDeviceId: z.string().min(1),
    preferredTransports: z.array(z.unknown()).min(1).max(MAX_PREFERRED_TRANSPORT_ENTRIES).pipe(z.array(transportEnum)),
});
export const connectIncomingPayloadSchema = z.object({
    relayRecoveryTicket: z.string().min(1).max(4096).optional(),
    recoveryTicket: z.string().min(1).max(4096).optional(),
    connectionId: z.string().min(1),
    clientDeviceId: z.string().min(1),
    clientIdentityKey: identityKeySchema,
    authorization: z.literal('account'),
    preferredTransports: z.array(z.unknown()).min(1).max(MAX_PREFERRED_TRANSPORT_ENTRIES).pipe(z.array(transportEnum)),
    relayEndpoint: z.string().url().optional(),
    relayTicket: z.string().min(1).optional(),
    relayNodeId: z.string().min(1).optional(),
    relayEpoch: z.number().int().nonnegative().optional(),
});
export const connectAcceptedPayloadSchema = z.object({
    relayRecoveryTicket: z.string().min(1).max(4096).optional(),
    recoveryTicket: z.string().min(1).max(4096).optional(),
    connectionId: z.string().min(1),
    relayEndpoint: z.string().url().optional(),
    relayTicket: z.string().min(1).optional(),
    relayNodeId: z.string().min(1).optional(),
    relayEpoch: z.number().int().nonnegative().optional(),
});
export const connectRejectedPayloadSchema = z.object({
    connectionId: z.string().min(1),
    code: z.string().optional(),
    message: z.string().optional(),
});
export const secureHandshakePayloadSchema = z.object({
    connectionId: z.string().min(1),
    targetDeviceId: z.string().min(1),
    step: z.union([z.literal(1), z.literal(2)]),
    data: canonicalBase64UrlSchema,
});
export const relayPayloadSchema = z.object({
    connectionId: z.string().min(1),
    targetDeviceId: z.string().min(1),
    counter: z.number().int().nonnegative().safe(),
    ciphertext: canonicalBase64UrlSchema,
});
export const signalPayloadSchema = z.object({
    connectionId: z.string().min(1),
    targetDeviceId: z.string().min(1),
    sdp: z.string().min(1),
});
export const signalIcePayloadSchema = z.object({
    connectionId: z.string().min(1),
    targetDeviceId: z.string().min(1),
    candidate: z.object({
        candidate: z.string().optional(),
        sdpMid: z.string().nullable().optional(),
        sdpMLineIndex: z.preprocess(normalizeSdpMLineIndex, z.number().int().nonnegative().nullable().optional()),
        usernameFragment: z.string().nullable().optional(),
    }),
});
export const transportSelectedPayloadSchema = z.object({
    connectionId: z.string().min(1),
    targetDeviceId: z.string().min(1),
    transport: selectedTransportEnum,
    /** Relay hostname the initiator actually used when transport is "turn"
     *  (best-effort, from ICE stats; absent for other transports). */
    turnNode: z.string().min(1).max(253).optional(),
});
export const pingPongPayloadSchema = z.object({
    nonce: z.string().min(1),
});
export const controlErrorPayloadSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    connectionId: z.string().min(1).optional(),
});
export const connectionLeaseRequestSchema = z.object({
    connectionId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    ticket: z.string().min(1).max(4096),
});
export const connectionLeaseAckSchema = connectionLeaseRequestSchema.extend({
    leaseMs: z.literal(WEBRTC_LEASE_MS),
});
const controlFramePayloadSchemas = {
    'hello': helloPayloadSchema,
    'hello.ack': helloAckPayloadSchema,
    'connect.request': connectRequestPayloadSchema,
    'connect.incoming': connectIncomingPayloadSchema,
    'connect.accepted': connectAcceptedPayloadSchema,
    'connect.rejected': connectRejectedPayloadSchema,
    'secure.handshake': secureHandshakePayloadSchema,
    'relay': relayPayloadSchema,
    'signal.offer': signalPayloadSchema,
    'signal.answer': signalPayloadSchema,
    'signal.ice': signalIcePayloadSchema,
    'transport.selected': transportSelectedPayloadSchema,
    'connection.lease.request': connectionLeaseRequestSchema,
    'connection.lease.ack': connectionLeaseAckSchema,
    'connection.lease.close': z.object({ connectionId: z.string().min(1).max(128) }),
    'ping': pingPongPayloadSchema,
    'pong': pingPongPayloadSchema,
    'error': controlErrorPayloadSchema,
};
export const rpcRequestPayloadSchema = z.object({
    method: rpcMethodSchema,
    params: z.unknown(),
});
export const rpcResponsePayloadSchema = z.object({
    requestId: z.string().min(1),
    result: z.unknown(),
});
export const rpcErrorPayloadSchema = z.object({
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    details: z.unknown().optional(),
});
export function createMessage(type, payload, id = cryptoRandomId()) {
    return {
        v: PROTOCOL_VERSION,
        id,
        type,
        timestamp: Date.now(),
        payload,
    };
}
export function createControlFrame(type, payload, id = cryptoRandomId()) {
    return {
        v: PROTOCOL_VERSION,
        id,
        type,
        timestamp: Date.now(),
        payload,
    };
}
export function createRelayDataFrame(type, payload, id = cryptoRandomId()) {
    return {
        v: PROTOCOL_VERSION,
        id,
        type,
        timestamp: Date.now(),
        payload,
    };
}
export function createRpcRequest(method, params, id) {
    return createMessage('rpc.request', { method, params }, id);
}
export function createRpcResponse(requestId, result) {
    return createMessage('rpc.response', { requestId, result });
}
export function createRpcError(requestId, code, message, details, retryable) {
    return createMessage('rpc.error', { requestId, code, message, details, retryable });
}
export function createEvent(event, data, options = {}) {
    return createMessage('event', { event, data, ...options });
}
export function parseRemoteMessage(input) {
    return remoteMessageSchema.parse(input);
}
export function parseControlFrame(input) {
    const frame = controlFrameSchema.parse(input);
    const payloadSchema = controlFramePayloadSchemas[frame.type];
    if (payloadSchema) {
        return { ...frame, payload: payloadSchema.parse(frame.payload) };
    }
    return frame;
}
export function encodeControlFrame(frame, limits = {}) {
    const parsed = parseControlFrame(frame);
    const encoded = JSON.stringify(parsed);
    assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, parsed.type, limits);
    return encoded;
}
export function decodeControlFrame(data, limits = {}) {
    const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (encoded.byteLength > MAX_RELAY_FRAME_BYTES)
        throw new Error('Control frame exceeds the Relay frame limit.');
    const frame = parseControlFrame(parseWireJson(data));
    assertControlFrameSize(encoded.byteLength, frame.type, limits);
    return frame;
}
export function encodeRelayDataFrame(frame, limits = {}) {
    const parsed = parseRelayDataFrame(frame);
    const encoded = JSON.stringify(parsed);
    assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, 'relay', limits);
    return encoded;
}
export function decodeRelayDataFrame(data, limits = {}) {
    const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    assertControlFrameSize(encoded.byteLength, 'relay', limits);
    try {
        return parseRelayDataFrame(parseWireJson(data));
    }
    catch {
        throw new Error('Invalid Relay data frame.');
    }
}
function parseRelayDataFrame(input) {
    const frame = relayDataFrameSchema.parse(input);
    if (frame.type === 'relay')
        return { ...frame, payload: relayPayloadSchema.parse(frame.payload) };
    if (frame.type === 'secure.handshake')
        return { ...frame, payload: secureHandshakePayloadSchema.parse(frame.payload) };
    return frame;
}
export function encodeMessage(message) {
    return new TextEncoder().encode(JSON.stringify(message));
}
export function decodeMessage(data) {
    return parseRemoteMessage(parseWireJson(data));
}
/**
 * Splits application plaintext before Noise encryption and reassembles it
 * after decryption. Noise transport messages have a 65,535-byte ceiling, so
 * large native ApiProxy responses cannot be encrypted as one message.
 */
export class SecureMessageCodec {
    nextMessageId = 1;
    assemblies = new Map();
    encode(message) {
        if (message.byteLength > MAX_SECURE_MESSAGE_BYTES) {
            throw new Error('Secure message exceeds the reassembly limit.');
        }
        if (message.byteLength <= SECURE_FRAGMENT_CHUNK_BYTES)
            return [message];
        const messageId = this.nextMessageId;
        this.nextMessageId = messageId === 0xffff_ffff ? 1 : messageId + 1;
        const total = Math.ceil(message.byteLength / SECURE_FRAGMENT_CHUNK_BYTES);
        const frames = [];
        for (let index = 0; index < total; index += 1) {
            const start = index * SECURE_FRAGMENT_CHUNK_BYTES;
            const chunk = message.subarray(start, Math.min(message.byteLength, start + SECURE_FRAGMENT_CHUNK_BYTES));
            const frame = new Uint8Array(SECURE_FRAGMENT_HEADER_BYTES + chunk.byteLength);
            frame.set(SECURE_FRAGMENT_MAGIC);
            frame[4] = SECURE_FRAGMENT_VERSION;
            const view = new DataView(frame.buffer);
            view.setUint32(5, messageId);
            view.setUint16(9, index);
            view.setUint16(11, total);
            view.setUint32(13, message.byteLength);
            frame.set(chunk, SECURE_FRAGMENT_HEADER_BYTES);
            frames.push(frame);
        }
        return frames;
    }
    decode(frame) {
        if (!isSecureFragment(frame))
            return frame;
        if (frame.byteLength < SECURE_FRAGMENT_HEADER_BYTES || frame[4] !== SECURE_FRAGMENT_VERSION) {
            throw new Error('Secure fragment header is invalid.');
        }
        const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
        const messageId = view.getUint32(5);
        const index = view.getUint16(9);
        const total = view.getUint16(11);
        const totalBytes = view.getUint32(13);
        if (messageId === 0 || total < 2 || index >= total || totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES
            || totalBytes > MAX_SECURE_MESSAGE_BYTES
            || total !== Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)) {
            throw new Error('Secure fragment metadata is invalid.');
        }
        const expectedChunkBytes = Math.min(SECURE_FRAGMENT_CHUNK_BYTES, totalBytes - index * SECURE_FRAGMENT_CHUNK_BYTES);
        const chunk = frame.subarray(SECURE_FRAGMENT_HEADER_BYTES);
        if (chunk.byteLength !== expectedChunkBytes)
            throw new Error('Secure fragment length is invalid.');
        let assembly = this.assemblies.get(messageId);
        if (assembly === undefined) {
            if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_SECURE_MESSAGES) {
                throw new Error('Secure fragment sequence is invalid.');
            }
            assembly = { total, totalBytes, receivedBytes: 0, chunks: [] };
            this.assemblies.set(messageId, assembly);
        }
        if (assembly.total !== total || assembly.totalBytes !== totalBytes || index !== assembly.chunks.length) {
            this.assemblies.delete(messageId);
            throw new Error('Secure fragment sequence is invalid.');
        }
        assembly.chunks.push(Uint8Array.from(chunk));
        assembly.receivedBytes += chunk.byteLength;
        if (assembly.chunks.length < total)
            return undefined;
        this.assemblies.delete(messageId);
        if (assembly.receivedBytes !== totalBytes)
            throw new Error('Secure message length is invalid.');
        const message = new Uint8Array(totalBytes);
        let offset = 0;
        for (const part of assembly.chunks) {
            message.set(part, offset);
            offset += part.byteLength;
        }
        return message;
    }
    reset() {
        this.nextMessageId = 1;
        this.assemblies.clear();
    }
}
function isSecureFragment(frame) {
    if (frame.byteLength < SECURE_FRAGMENT_MAGIC.byteLength)
        return false;
    for (let index = 0; index < SECURE_FRAGMENT_MAGIC.byteLength; index += 1) {
        if (frame[index] !== SECURE_FRAGMENT_MAGIC[index])
            return false;
    }
    return true;
}
function assertControlFrameSize(bytes, type, limits) {
    const configured = type === 'relay' ? limits.maxRelayFrameBytes : limits.maxControlFrameBytes;
    const protocolMaximum = type === 'relay' ? MAX_RELAY_FRAME_BYTES : MAX_CONTROL_FRAME_BYTES;
    const maximum = configured === undefined ? protocolMaximum : Math.min(protocolMaximum, configured);
    if (!Number.isSafeInteger(maximum) || maximum <= 0)
        throw new Error('Control frame limit is invalid.');
    if (bytes > maximum)
        throw new Error(`${type === 'relay' ? 'Relay' : 'Control'} frame exceeds its limit.`);
}
function cryptoRandomId() {
    const g = globalThis.crypto;
    if (g?.randomUUID)
        return g.randomUUID();
    return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
