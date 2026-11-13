import { type RemoteWorkspaceTypeDescription, type RemoteCompactionStatusParams, type RemoteCompactionStatusResult, type RemoteCompactionSubmitParams, type RemoteCompactionSubmitResult } from '@dsh-remote/protocol';
import type { RemoteClientCore, RemoteRpcOptions } from './index.js';
/** Gateway call options; `maxResponseBytes` caps what a transferred response may allocate locally. */
export interface RemoteGatewayOptions extends RemoteRpcOptions {
    maxResponseBytes?: number;
    chunkTimeoutMs?: number;
}
export interface RemoteHostFeatures {
    commandList: boolean;
    fileViewer: boolean;
    apiProxy: boolean;
    apiTransfer: boolean;
    remoteGateway: boolean;
    sessionFormat?: 3;
    remoteTransfer: boolean;
    pluginRoute: boolean;
    capabilities: readonly string[];
    workspaceTypes?: readonly RemoteWorkspaceTypeDescription[];
}
/** Optional type declarations refine negotiated capabilities; legacy Hosts omit them. */
export declare function remoteWorkspaceTypeAvailable(capabilities: readonly string[], workspaceTypes: readonly RemoteWorkspaceTypeDescription[] | undefined, id: string, capability: string): boolean;
export interface RemoteGatewayFailure {
    code: string;
    message: string;
    details: Record<string, unknown>;
}
export type RemoteGatewayResult<T = unknown> = {
    ok: true;
    value?: T;
} | {
    ok: false;
    error: RemoteGatewayFailure;
};
export interface RemoteGatewayStream extends AsyncIterable<unknown> {
    close(notifyRemote?: boolean): Promise<void>;
}
export interface TypertGatewayRequest {
    namespace: string;
    method: string;
    args: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
}
export declare class RemoteGatewayError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>, options?: ErrorOptions);
}
/** Conservative feature profile for Hosts that predate capability discovery. */
export declare function remoteHostFeatures(clientVersion?: string): RemoteHostFeatures;
export declare function probeRemoteHostFeatures(client: RemoteClientCore, clientVersion?: string): Promise<RemoteHostFeatures>;
/** Client-side alpha Gateway carrier over the authenticated Remote channel. */
export declare class RemoteTypertGateway {
    private readonly client;
    constructor(client: RemoteClientCore);
    invoke(request: TypertGatewayRequest): Promise<unknown>;
    /**
     * Register an asynchronous Host compaction. Resolves as soon as the Host
     * accepts the operation; the compaction itself keeps running on the Host even
     * if this client disconnects.
     */
    submitCompaction(params: RemoteCompactionSubmitParams, signal?: AbortSignal): Promise<RemoteCompactionSubmitResult>;
    /** Read the settled or in-flight state of one compaction operation. */
    compactionStatus(params: RemoteCompactionStatusParams, signal?: AbortSignal): Promise<RemoteCompactionStatusResult>;
    /** Ask the Host to cancel; the Host answers only after the command settles. */
    cancelCompaction(params: RemoteCompactionStatusParams, signal?: AbortSignal): Promise<RemoteCompactionStatusResult>;
    call<T = unknown>(endpoint: string, payload: unknown, signal?: AbortSignal, options?: RemoteGatewayOptions): Promise<T>;
    dispatch<T = unknown>(endpoint: string, payload: unknown, signal?: AbortSignal, options?: RemoteGatewayOptions): Promise<RemoteGatewayResult<T>>;
    open(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RemoteGatewayStream>;
    failure(error: unknown): RemoteGatewayFailure;
    private iterate;
    private callTransferred;
}
export declare function createRemoteId(): string;
