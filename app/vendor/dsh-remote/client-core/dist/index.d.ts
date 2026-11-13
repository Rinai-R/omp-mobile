import { type EventPayload, type RemoteEventName } from '@dsh-remote/protocol';
import type { RemoteTransport } from '@dsh-remote/webrtc';
export type RemoteClientErrorCode = 'RPC_TIMEOUT' | 'RPC_ABORTED' | 'TRANSPORT_CLOSED' | 'CLIENT_CLOSED';
export declare class RemoteClientError extends Error {
    readonly code: RemoteClientErrorCode;
    constructor(code: RemoteClientErrorCode, message: string, options?: ErrorOptions);
}
/** Per-call override for endpoints that legitimately outlive the client-wide deadline. */
export interface RemoteRpcOptions {
    timeoutMs?: number;
}
export declare class RemoteClientCore {
    private readonly transport;
    private readonly timeoutMs;
    private readonly pending;
    private readonly eventHandlers;
    private unsubscribeTransport?;
    private unsubscribeClose?;
    private readonly closeHandlers;
    private closeNotified;
    private terminalCode?;
    constructor(transport: RemoteTransport, timeoutMs?: number);
    connect(): Promise<void>;
    rpc<TResult = unknown, TParams = unknown>(method: string, params: TParams, signal?: AbortSignal, options?: RemoteRpcOptions | number): Promise<TResult>;
    onEvent(handler: (event: EventPayload) => void): () => void;
    onClose(handler: (error?: Error) => void): () => void;
    getStats(): import("@dsh-remote/protocol").TransportStats;
    close(): Promise<void>;
    private handleTransportClose;
    private handleMessage;
    private handleResponse;
    private handleError;
    private takePending;
    private rejectPending;
    private rejectAllPending;
    private notifyClose;
}
export type { EventPayload, RemoteEventName, RemoteTransport };
export * from './remote-gateway.js';
export * from './harness-alpha-client.js';
export * from './codex-client.js';
export * from './acp-client.js';
