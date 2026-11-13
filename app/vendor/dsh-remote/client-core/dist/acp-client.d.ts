import type { AcpModelSelection, AcpSessionModels, AcpWorkspaceToolCallEndpoint, AgentAcpStreamOpenParams, AgentAcpFrameData, AgentAcpStreamClosedData, AcpSessionArchivedData } from '@dsh-remote/protocol';
import type { RemoteClientCore } from './index.js';
export type AcpAgentBackend = 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes' | (string & {});
/**
 * `session/prompt` blocks until the upstream turn finishes. Keep this well above
 * the default RemoteClientCore timeout (Android uses ~35s for ApiProxy).
 */
export declare const ACP_PROMPT_RPC_TIMEOUT_MS: number;
export interface AcpRemoteSession {
    sessionId: string;
    cwd?: string;
    mode?: 'agent' | 'plan' | 'ask';
}
export interface AcpStream {
    streamId: string;
    close(): Promise<void>;
}
/** Shared Web/Android client for the generic Agent ACP domain in Remote. */
export declare class AgentAcpClient {
    private readonly core;
    private readonly capabilities;
    constructor(core: RemoteClientCore, capabilities?: readonly string[]);
    supportsArchive(backend: string): boolean;
    onSessionArchived(handler: (data: AcpSessionArchivedData) => void): () => void;
    archiveSession(sessionId: string, backend: string, signal?: AbortSignal): Promise<AcpSessionArchivedData>;
    call(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown>;
    initialize(params?: {
        protocolVersion?: number;
        clientInfo?: {
            name?: string;
            version?: string;
        };
    }, signal?: AbortSignal): Promise<unknown>;
    respond(requestHandle: string, decision: 'allow-once' | 'reject-once' | 'cancel', result?: unknown, signal?: AbortSignal): Promise<unknown>;
    sessionModels(sessionId: string, backend: 'cursor' | 'claude' | 'antigravity' | 'pi' | 'opencode' | 'hermes', signal?: AbortSignal): Promise<AcpSessionModels>;
    selectModel(sessionId: string, backend: 'cursor' | 'claude' | 'antigravity' | 'pi' | 'opencode' | 'hermes', selection: AcpModelSelection, signal?: AbortSignal): Promise<AcpModelSelection>;
    selectPermission(sessionId: string, backend: 'cursor' | 'claude' | 'antigravity' | 'pi' | 'opencode' | 'hermes', preset: string, signal?: AbortSignal): Promise<unknown>;
    workspaceToolCall(sessionId: string, backend: 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes', endpoint: AcpWorkspaceToolCallEndpoint, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    listWorkspaces(backend?: AcpAgentBackend, signal?: AbortSignal): Promise<Array<{
        path: string;
        title?: string;
        sessionCount?: number;
    }>>;
    listSessions(path: string, backend?: AcpAgentBackend, limit?: number, signal?: AbortSignal): Promise<Array<{
        conversationId: string;
        title: string;
        createdAt: number;
        updatedAt: number;
    }>>;
    loadSessionHistory(sessionId: string, backend?: AcpAgentBackend, signal?: AbortSignal): Promise<unknown[]>;
    createSession(cwd: string, mode?: 'agent' | 'plan' | 'ask', backend?: AcpAgentBackend, signal?: AbortSignal): Promise<AcpRemoteSession>;
    prompt(sessionId: string, text: string, signal?: AbortSignal, images?: Array<{
        type: 'image';
        mimeType: string;
        data: string;
    }>, backend?: AcpAgentBackend): Promise<unknown>;
    cancel(sessionId: string, signal?: AbortSignal): Promise<unknown>;
    listDirectory(path: string, signal?: AbortSignal): Promise<unknown>;
    openStream(sessionId: string, onFrame: (frame: AgentAcpFrameData) => void, onClosed?: (closed: AgentAcpStreamClosedData) => void, signal?: AbortSignal, tool?: AgentAcpStreamOpenParams['tool']): Promise<AcpStream>;
    transferCall(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
}
export declare function sessionScopedStreamId(sessionId: string): string;
