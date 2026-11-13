import type { RemoteClientCore } from './index.js';
import { type RemoteCompactionState, type RemoteCompactionStatusResult, type RemoteCompactionSubmitResult } from '@dsh-remote/protocol';
export interface HarnessAlphaHostInfo {
    clientVersion?: string;
    harnessVersion?: string;
    sessionFormat?: 3;
    /** Capabilities negotiated by `probeRemoteHostFeatures`. */
    capabilities?: readonly string[];
}
/** Options for {@link HarnessAlphaClient.compactSession}. */
export interface RemoteCompactionRunOptions {
    /** Resume polling an operation submitted earlier instead of submitting again. */
    operationId?: string;
    /** Idempotency key for a fresh submission; retries with the same id dedupe. */
    requestId?: string;
    /** Host-side budget for the compaction task itself. */
    budgetMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    onStatus?: (status: RemoteCompactionStatusResult) => void;
}
/** Durable client-side record of one compaction attempt. */
export interface RemoteCompactionRecord {
    sessionId: string;
    /** Idempotency key saved before submission so a lost response is recoverable. */
    requestId: string;
    operationId?: string;
    state: RemoteCompactionState;
    updatedAt: number;
}
/**
 * Persistence used by the product call path. Scope should identify the Host
 * (for example its device id) so records never cross Hosts.
 */
export interface RemoteCompactionStore {
    load(scope: string, sessionId: string): Promise<RemoteCompactionRecord | undefined>;
    list(scope: string): Promise<RemoteCompactionRecord[]>;
    save(scope: string, record: RemoteCompactionRecord): Promise<void>;
    remove(scope: string, sessionId: string): Promise<void>;
}
export interface RemoteCompactionPersistence {
    store: RemoteCompactionStore;
    scope: string;
}
/**
 * Result of a tracked compaction. `unconfirmed` means observation failed; it
 * is not a failure of the compaction and must not trigger a second run.
 */
export type RemoteCompactionOutcome = {
    kind: 'settled';
    status: RemoteCompactionStatusResult;
} | {
    kind: 'unconfirmed';
    status?: RemoteCompactionStatusResult;
    message: string;
};
export interface HarnessClientFrame {
    rpcId: string;
    payload: Record<string, unknown>;
}
export interface HarnessModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface HarnessModelProviderGroup {
    id: string;
    name: string;
    models: Array<{
        id: string;
        name: string;
        description?: string;
        reasoning?: {
            efforts: Array<{
                id: string;
                name: string;
                description?: string;
            }>;
            defaultEffort?: string;
        };
    }>;
}
export interface HarnessSessionModels {
    current: HarnessModelSelection;
    routable: boolean;
    groups: HarnessModelProviderGroup[];
    failures: Array<{
        id: string;
        name: string;
        message: string;
    }>;
}
export interface HarnessRemoteSession {
    sessionId: string;
    updatedAt: number;
    running: boolean;
    blank: boolean;
    title?: string;
    parentSessionId?: string;
    origin?: 'subagent';
    cwd?: string;
    agentPreset?: string;
    projections?: {
        asOfSeq?: number;
        values?: Record<string, unknown>;
    };
}
export interface HarnessAgentPresetRow {
    id: string;
    isDefault: boolean;
    name?: string;
    description?: string;
    broken?: string;
}
export interface HarnessAgentPresetRoster {
    presets: HarnessAgentPresetRow[];
}
export interface HarnessWorkspaceView {
    workspaceId: string;
    path: string;
    title: string;
    sessionIds: string[];
    createdAt: string;
    updatedAt: string;
}
export interface HarnessWorkspaceList {
    items: HarnessWorkspaceView[];
    archivedSessionIds: string[];
    pinnedSessionIds?: string[];
}
export type ScheduleKind = 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron';
export interface ScheduleDeliveryReceipt {
    scheduledAt: string;
    deliveredAt: string;
    messageId: string;
}
export interface ScheduleDeliveryRecord extends ScheduleDeliveryReceipt {
    prompt?: string;
}
export interface ScheduleCatalogEntry {
    id: string;
    sessionId: string;
    kind: ScheduleKind;
    title: string;
    prompt: string;
    scheduledAt: string;
    status: 'active' | 'inactive';
    afterSeconds?: number;
    everySeconds?: number;
    time?: string;
    timeZone?: string;
    weekdays?: number[];
    expression?: string;
    lastDelivery?: ScheduleDeliveryReceipt;
}
export interface ScheduleDeleteResult {
    id: string;
    deleted?: boolean;
    code?: string;
}
export interface ScheduleCreateRequest {
    title: string;
    prompt: string;
    after_seconds?: number;
    at?: string | {
        date: string;
        time: string;
        time_zone: string;
    };
    every_seconds?: number;
    daily?: {
        time: string;
        time_zone: string;
    };
    weekly?: {
        time: string;
        time_zone: string;
        weekdays: number[];
    };
    cron?: {
        expression: string;
        time_zone: string;
    };
}
export type ScheduleTimingChange = {
    kind: 'at';
    at: string | {
        date: string;
        time: string;
        time_zone: string;
    };
} | {
    kind: 'every';
    every_seconds: number;
} | {
    kind: 'daily';
    daily: {
        time: string;
        time_zone: string;
    };
} | {
    kind: 'weekly';
    weekly: {
        time: string;
        time_zone: string;
        weekdays: number[];
    };
} | {
    kind: 'cron';
    cron: {
        expression: string;
        time_zone: string;
    };
};
export type ScheduleRecord = {
    id: string;
    kind: 'after';
    title: string;
    prompt: string;
    afterSeconds: number;
    scheduledAt: string;
} | {
    id: string;
    kind: 'at';
    title: string;
    prompt: string;
    scheduledAt: string;
} | {
    id: string;
    kind: 'every';
    title: string;
    prompt: string;
    everySeconds: number;
    scheduledAt: string;
} | {
    id: string;
    kind: 'daily';
    title: string;
    prompt: string;
    time: string;
    timeZone: string;
    scheduledAt: string;
} | {
    id: string;
    kind: 'weekly';
    title: string;
    prompt: string;
    time: string;
    timeZone: string;
    weekdays: number[];
    scheduledAt: string;
} | {
    id: string;
    kind: 'cron';
    title: string;
    prompt: string;
    expression: string;
    timeZone: string;
    scheduledAt: string;
};
export interface ScheduleUpdateRequest {
    sessionId: string;
    id: string;
    expected: ScheduleRecord;
    change?: ScheduleTimingChange;
    title?: string;
    prompt?: string;
}
export type ScheduleUpdateResult = {
    id: string;
    updated: boolean;
    record: ScheduleRecord;
} | {
    id: string;
    updated: false;
    code: 'schedule_not_found' | 'schedule_ended' | 'schedule_conflict';
} | {
    code: string;
    message: string;
};
export interface ScheduleDeliveryHistoryResult {
    id: string;
    records?: ScheduleDeliveryRecord[];
    earlierRecordsUnavailable?: boolean;
    earlierRecordsPruned?: boolean;
    retention?: {
        days: number;
        records: number;
    };
    code?: string;
}
export interface HarnessPluginApplication {
    /** `applied`, `restart-required`, `overridden` or `cancelled`; failures throw. */
    application: string;
}
export interface HarnessSettingsNamespace {
    ns: string;
    /** Serialized Schemastery envelope. */
    schema: unknown;
    value: unknown;
    user?: unknown;
    revision: number;
}
export interface HarnessSettingsDescribe {
    writable: boolean;
    namespaces: HarnessSettingsNamespace[];
}
export type HarnessSettingsPathOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
export interface HarnessDirectoryEntry {
    name: string;
    path: string;
    hidden: boolean;
}
export interface HarnessDirectoryListing {
    path: string;
    home: string;
    crumbs: HarnessDirectoryEntry[];
    entries: HarnessDirectoryEntry[];
    truncated: boolean;
}
export interface HarnessHostDescriptor {
    version: string;
    cwd: string;
    provider?: string;
    model?: string;
    attachedSessions: number;
    canOpenPath: boolean;
}
export interface HarnessPromptImage {
    mediaType: string;
    data: string;
    name?: string;
}
export interface HarnessQuestionAnswer {
    answers: Array<{
        id: string;
        selected: string[];
        custom?: string;
    }>;
}
export interface HarnessSessionEvent {
    type: string;
    seq: number;
    time: number;
    data: Record<string, unknown>;
    sourceEventSeqs?: number[];
    surfaceOp?: HarnessSurfaceOp;
    ignorable?: true;
}
export type HarnessSurfaceOp = 'append' | {
    op: 'replace';
    start: number;
    end: number;
} | {
    op: 'replace';
    startSeq: number;
    endSeq: number;
};
export interface HarnessHistoryEntry {
    event: HarnessSessionEvent;
    view?: {
        for: 'call' | 'result';
        view: unknown;
    };
}
export interface HarnessSessionHistoryPage {
    events: HarnessHistoryEntry[];
    hasMore: boolean;
    throughSeq?: number;
}
export declare class HarnessAlphaClient {
    private readonly host;
    private readonly onFrame?;
    private readonly compactionPersistence?;
    readonly mode: "remote";
    private readonly questions;
    private readonly gateway;
    private readonly sessionsCache;
    private readonly selectedModels;
    private readonly followCursors;
    private readonly pendingEvents;
    private events?;
    private control?;
    private sessionFollow?;
    private followGeneration;
    private eventClientId?;
    private eventHostHome?;
    constructor(core: RemoteClientCore, host?: HarnessAlphaHostInfo, onFrame?: ((frame: HarnessClientFrame) => void) | undefined, compactionPersistence?: RemoteCompactionPersistence | undefined);
    start(): void;
    close(notifyRemote?: boolean): Promise<void>;
    sessionList(): Promise<HarnessRemoteSession[]>;
    sessionCreate(workspaceId?: string, cwd?: string): Promise<{
        sessionId: string;
    }>;
    messageFeedbackList(sessionId: string): Promise<Array<{
        messageId: string;
        rating: 'positive' | 'negative';
        version: string;
    }>>;
    messageFeedbackPut(sessionId: string, messageId: string, rating: 'positive' | 'negative'): Promise<{
        messageId: string;
        rating: 'positive' | 'negative';
        version: string;
    }>;
    sessionFork(sessionId: string, atSeq?: number): Promise<{
        sessionId: string;
    }>;
    sessionModels(sessionId: string): Promise<HarnessSessionModels>;
    sessionSelectModel(sessionId: string, selection: HarnessModelSelection): Promise<HarnessModelSelection>;
    sessionExecuteCommand(sessionId: string, line: string): Promise<{
        kind: 'success' | 'error';
        text?: string;
    }>;
    /** True when the Host advertises the Remote-owned asynchronous compaction contract. */
    get supportsAsyncCompaction(): boolean;
    /** Submit `/compact` without holding one RPC open for the whole run. */
    submitCompaction(sessionId: string, options?: {
        requestId?: string;
        budgetMs?: number;
        signal?: AbortSignal;
    }): Promise<RemoteCompactionSubmitResult>;
    compactionStatus(sessionId: string, operationId: string, signal?: AbortSignal): Promise<RemoteCompactionStatusResult>;
    cancelCompaction(sessionId: string, operationId: string, signal?: AbortSignal): Promise<RemoteCompactionStatusResult>;
    /**
     * Submit (or resume) one compaction and poll until it settles.
     *
     * Polling is observation only. Closing this client, a page or a connection
     * does not abort the Host run: resume by passing the operation id again.
     */
    compactSession(sessionId: string, options?: RemoteCompactionRunOptions): Promise<RemoteCompactionStatusResult>;
    /**
     * Product-facing tracked compaction.
     *
     * The requestId is persisted before submission and the operationId as soon as
     * the Host answers, so a lost submit response or a reconnect can query the
     * same Host operation instead of starting a second compaction. Observation
     * failures return `unconfirmed`, never a failure.
     */
    compactSessionTracked(sessionId: string, options?: RemoteCompactionRunOptions): Promise<RemoteCompactionOutcome>;
    /**
     * Ask the Host to cancel the tracked compaction for one Session. Returns
     * undefined when no persisted operation exists (for example a legacy Host or
     * a command that was never tracked).
     */
    cancelTrackedCompaction(sessionId: string): Promise<RemoteCompactionStatusResult | undefined>;
    /** Query every persisted attempt for this Host scope, usually after reconnect. */
    resumeCompactions(options?: {
        signal?: AbortSignal;
        onOutcome?: (sessionId: string, outcome: RemoteCompactionOutcome) => void;
    }): Promise<Array<{
        sessionId: string;
        outcome: RemoteCompactionOutcome;
    }>>;
    private submitCompactionWithRetry;
    private pollCompaction;
    sessionSelectPermission(sessionId: string, preset: string): Promise<void>;
    /** Read the Host's agent-preset (mode) roster for the mode picker. */
    agentPresetList(): Promise<HarnessAgentPresetRoster>;
    /** Select the agent preset (mode) of a session that has not started its first turn. */
    agentPresetSelect(sessionId: string, agentPreset: string): Promise<string>;
    /**
     * Official SessionAddress: a subagent session must be addressed through its
     * durable parent (`{ kind: 'subagent', parentSessionId, childSessionId }`);
     * the plain session form is rejected with `session/agent-busy`.
     */
    private sessionAddress;
    sessionHistory(sessionId: string, beforeSeq?: number, maxMessages?: number, parentSessionId?: string): Promise<HarnessSessionHistoryPage>;
    /** Stage exact file bytes in the receiving Session; only its receipt may be submitted. */
    sessionUploadFile(sessionId: string, data: string, name?: string): Promise<{
        receiptId: string;
        file: unknown;
    }>;
    sessionPrompt(sessionId: string, text: string, requestId?: string, images?: HarnessPromptImage[], files?: {
        receiptId: string;
    }[]): Promise<void>;
    sessionCancel(sessionId: string): Promise<void>;
    sessionAttachment(sessionId: string, attachment: string | Record<string, unknown>): Promise<{
        attachment: unknown;
        data: string;
    }>;
    /** Apply one operation to a still-pending queue occurrence (official QueueAction subset). */
    sessionUpdateQueue(sessionId: string, itemId: string, action: {
        kind: 'remove' | 'steer';
    }): Promise<void>;
    hostDescribe(): Promise<HarnessHostDescriptor>;
    hostListDirectory(path?: string): Promise<HarnessDirectoryListing>;
    workspaceList(): Promise<HarnessWorkspaceList>;
    workspaceCreate(path: string): Promise<{
        workspace: HarnessWorkspaceView;
        created: boolean;
    }>;
    workspaceRename(workspaceId: string, title: string): Promise<HarnessWorkspaceView>;
    workspaceDelete(workspaceId: string): Promise<void>;
    workspaceArchiveSession(sessionId: string, options?: {
        stopActivity?: boolean;
    }): Promise<string[]>;
    workspaceUnarchiveSession(sessionId: string): Promise<string[]>;
    workspacePinSession(sessionId: string): Promise<string[]>;
    workspaceUnpinSession(sessionId: string): Promise<string[]>;
    sessionRename(sessionId: string, title: string): Promise<{
        title: string;
        seq: number;
    }>;
    workspaceInsertBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<string[]>;
    scheduleCatalog(): Promise<ScheduleCatalogEntry[]>;
    scheduleCreate(sessionId: string, request: ScheduleCreateRequest): Promise<ScheduleRecord>;
    scheduleUpdate(request: ScheduleUpdateRequest): Promise<ScheduleUpdateResult>;
    scheduleDelete(sessionId: string, id: string): Promise<ScheduleDeleteResult>;
    scheduleHistory(sessionId: string, id: string, limit?: number, before?: string): Promise<ScheduleDeliveryHistoryResult>;
    /** Official plugin inventory; the Host hides its own Remote transport rows. */
    pluginListBundles(): Promise<unknown[]>;
    pluginListPlugins(): Promise<unknown[]>;
    /** Switch a bundle (by package name) or one of its rows (by entry id); the Host re-checks its inventory. */
    pluginSetEnabled(kind: 'bundle' | 'plugin', target: string, enabled: boolean): Promise<HarnessPluginApplication>;
    settingsDescribe(): Promise<HarnessSettingsDescribe>;
    /** Path-addressed edits against the revision the form was read at; stale writes are refused by the Host. */
    settingsMutate(ns: string, ops: HarnessSettingsPathOp[], expectedRevision: number): Promise<void>;
    respondApproval(frameRpcId: string, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void>;
    respondQuestion(frameRpcId: string, sessionId: string, answer: HarnessQuestionAnswer): Promise<void>;
    private respondEvent;
    private callValue;
    private pumpEvents;
    private pumpControl;
    private pumpSessionFollow;
    private entriesFromSessionFollow;
    private routeEventFrame;
    private routeWaterfall;
    private republishPendingSessionInteractions;
    private cancelRemoteEvent;
    private routeControlFrame;
    private applyProjectionBaseline;
    private applyProjection;
    private emitStreamFailure;
    private emitFrame;
    private closeSessionFollow;
    /**
     * Bound one phase of opening a session follow. An unanswered open (observed
     * for subagent-parent addresses) must fail loudly instead of hanging the
     * caller's session switch forever.
     */
    private boundedFollow;
    private closeHandle;
}
