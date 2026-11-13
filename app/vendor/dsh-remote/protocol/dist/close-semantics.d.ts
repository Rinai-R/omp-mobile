/**
 * WebSocket close semantics for the control channel.
 *
 * Close codes are a *versioned transport detail*; the close reason is the
 * capability-independent semantic key. Two different implementations disagree
 * on the code today, so every endpoint must classify by (code, reason) pairs
 * through this module instead of testing `event.code` on its own:
 *
 * - `apps/server` (self-hosted) sends `4009` / `server shutdown` on graceful
 *   shutdown (`SERVER_SHUTDOWN_CLOSE_CODE`).
 * - The hosted Server's hub currently closes sockets with `4001` /
 *   `server shutdown` and reserves `4009` for heartbeat expiry
 *   (`heartbeat timeout`). `4001` is therefore accepted as a historical alias
 *   for the shutdown semantics; it still means timeout/auth failure for every
 *   other reason.
 * - `1013` / `server shutdown` is the WebSocket "try again later" alias.
 *
 * Never derive session-retention from a bare code: `4009` alone is a
 * heartbeat timeout on the hosted Server, and `4001` alone is also used for
 * hello timeouts, heartbeat expiry and authorization failures.
 */
/** Exact reason string that marks a Server-initiated, expected outage. */
export declare const SERVER_SHUTDOWN_REASON = "server shutdown";
/** Close codes that may carry {@link SERVER_SHUTDOWN_REASON}. */
export declare const SERVER_SHUTDOWN_CLOSE_CODES: readonly number[];
/** Hosted Server heartbeat expiry: the peer went away, not the Server. */
export declare const HEARTBEAT_TIMEOUT_CLOSE_CODE = 4009;
export declare const HEARTBEAT_TIMEOUT_REASON = "heartbeat timeout";
/** `4001` with this reason is documented as a retryable heartbeat failure. */
export declare const HEARTBEAT_CONNECTION_FAILED_REASON = "CONNECTION_FAILED";
/**
 * Close codes where the control socket simply went away: a polite normal
 * closure initiated by either side, an established connection that was never
 * closed politely, a server that is going away, or a handshake that never
 * completed.
 */
export declare const TRANSIENT_CONTROL_CLOSE_CODES: readonly number[];
/**
 * True only for an intentional, expected Server outage.
 *
 * This is the gate for lease-backed session retention (keep authenticated
 * data-plane state and recover the control channel in the background) and for
 * spreading the first recovery attempt over a jitter window so a restarting
 * Server does not receive the whole fleet at once.
 */
export declare function isServerShutdownClose(code: number, reason?: string | null): boolean;
/**
 * True when the peer itself stopped answering (heartbeat expiry).
 *
 * This is indistinguishable from a network partition and must never be
 * treated as a Server-restart signal.
 */
export declare function isHeartbeatTimeoutClose(code: number, reason?: string | null): boolean;
/**
 * Close codes that another instance replaced, revoked or otherwise terminated
 * explicitly. Retrying these without user action cannot succeed.
 */
export declare const TERMINAL_CONTROL_CLOSE_CODES: readonly number[];
export interface ControlCloseClassification {
    /** Expected Server outage; eligible for lease-backed retention. */
    serverShutdown: boolean;
    /**
     * Peer heartbeat expiry. Retryable and safe to retain across (it is
     * indistinguishable from a network partition), but it never means the
     * Server restarted.
     */
    heartbeatTimeout: boolean;
    /** Polite or transient close that may be retried. */
    retryable: boolean;
    /** Another instance took over this identity. */
    replaced: boolean;
}
/**
 * One classifier shared by every endpoint (Host plugin, WebRTC transport,
 * Relay transport, apps).
 *
 * `retryable` is deliberately *not* "every code except terminal auth": only
 * the documented transient codes, the shutdown pair and the heartbeat pair
 * qualify, so an unknown or new application close code is treated as terminal
 * by the transport and never silently widens session retention. Whether an
 * endpoint additionally retries the connection for an unknown code is a
 * transport-policy decision made by that endpoint.
 */
export declare function classifyControlClose(code: number, reason?: string | null): ControlCloseClassification;
