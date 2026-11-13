import type { CodexAppFrameData, CodexAppStreamClosedData } from '@dsh-remote/protocol';
import type { RemoteClientCore } from './index.js';
export type AgentBackend = 'harness' | 'codex';
export interface DisplaySession {
    id: string;
    backend: AgentBackend;
    nativeId: string;
    sessionTreeId?: string;
    title?: string;
    preview?: string;
    cwd?: string;
    /** Model reported by the CodeX Thread or its most recent Turn. */
    model?: string;
    reasoningEffort?: string;
    createdAt: number;
    updatedAt: number;
    status: 'idle' | 'running' | 'waiting' | 'failed';
    archived?: boolean;
    pinned?: boolean;
}
export interface CodexCwdWorkspace {
    id: string;
    name: string;
    path: string;
    position: number;
    createdAt: number;
    updatedAt: number;
}
export interface DisplayImage {
    uri: string;
    name?: string;
}
export interface DisplayHistoryItem {
    id: string;
    sessionId: string;
    backend: AgentBackend;
    kind: 'message' | 'tool' | 'file-change' | 'approval' | 'status' | 'error' | 'unknown';
    role?: 'user' | 'assistant';
    text?: string;
    images?: DisplayImage[];
    status?: 'running' | 'completed' | 'failed' | 'declined';
    createdAt?: number;
    nativeRef: {
        threadId?: string;
        turnId?: string;
        itemId?: string;
        requestHandle?: string;
    };
    details?: Record<string, unknown>;
}
export interface CodexThreadListPage {
    sessions: DisplaySession[];
    nextCursor?: string;
}
export interface CodexHistoryView {
    session: DisplaySession;
    items: DisplayHistoryItem[];
}
export interface CodexPendingApproval {
    requestHandle: string;
    kind: 'command' | 'file-change';
    command?: string;
    reason?: string;
}
export interface CodexTimelineState {
    session: DisplaySession;
    items: DisplayHistoryItem[];
    activeTurnId?: string;
    approval?: CodexPendingApproval;
}
export interface CodexStream {
    streamId: string;
    close(): Promise<void>;
}
/** Shared Web/Android client for the independent Codex domain in Remote. */
export declare class CodexRemoteClient {
    private readonly core;
    private readonly historyPreview;
    constructor(core: RemoteClientCore, historyPreview?: boolean);
    /** Low-level allowlisted request used by the Desktop Web loopback facade. */
    private previewSupported;
    request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
    account(signal?: AbortSignal): Promise<unknown>;
    models(signal?: AbortSignal): Promise<unknown>;
    threads(params?: Record<string, unknown>, signal?: AbortSignal): Promise<CodexThreadListPage>;
    history(threadId: string, signal?: AbortSignal): Promise<CodexHistoryView>;
    start(cwd: string, model?: string, signal?: AbortSignal): Promise<DisplaySession>;
    resume(threadId: string, signal?: AbortSignal): Promise<DisplaySession>;
    fork(threadId: string, lastTurnId?: string, signal?: AbortSignal): Promise<DisplaySession>;
    rename(threadId: string, name: string, signal?: AbortSignal): Promise<void>;
    prompt(threadId: string, text: string, signal?: AbortSignal): Promise<unknown>;
    steer(threadId: string, expectedTurnId: string, text: string, signal?: AbortSignal): Promise<unknown>;
    interrupt(threadId: string, turnId: string, signal?: AbortSignal): Promise<void>;
    respond(requestHandle: string, decision: 'accept' | 'decline' | 'cancel', signal?: AbortSignal): Promise<void>;
    subscribe(threadId: string, onFrame: (frame: CodexAppFrameData['frame']) => void, signal?: AbortSignal, onClose?: (reason: CodexAppStreamClosedData['reason']) => void): Promise<CodexStream>;
    private call;
    private callTransferred;
}
export declare function projectCodexThread(value: unknown): DisplaySession | undefined;
/**
 * Extract model metadata without assuming one App Server release's exact
 * Thread shape. Newer servers put it on the Thread, while older responses
 * expose it only on the most recent Turn.
 */
export declare function projectCodexModel(value: unknown): {
    model?: string;
    reasoningEffort?: string;
};
/**
 * Builds a deterministic, bounded Workspace fallback from cwd values that the
 * App Server already exposed through thread/list. Callers should use this only
 * when project/list has no usable projects.
 */
export declare function deriveCodexCwdWorkspaces(values: unknown[]): CodexCwdWorkspace[];
export declare function projectCodexHistory(thread: unknown): DisplayHistoryItem[];
/** Creates a replaceable persisted baseline before live notifications are reduced. */
export declare function createCodexTimelineState(thread: unknown): CodexTimelineState | undefined;
/**
 * Reduces official App Server notifications into the DSH display projection.
 * Persisted baselines replace this state after reconnect; mutations are never
 * replayed by the reducer.
 */
export declare function reduceCodexTimelineFrame(state: CodexTimelineState, frame: {
    method: string;
    params: unknown;
}): CodexTimelineState;
export declare function projectCodexItem(value: unknown, threadId: string, turnId: string, sessionId: string, index: number): DisplayHistoryItem;
