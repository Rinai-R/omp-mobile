import { HarnessQuestions } from './harness-questions.js';
import { RemoteGatewayError, RemoteTypertGateway, createRemoteId } from './remote-gateway.js';
import { REMOTE_COMPACTION_CAPABILITY, } from '@dsh-remote/protocol';
const LEGACY_AGENT_PRESET = 'code';
const LEGACY_AGENT_PRESET_TARGET = 'ptc';
export class HarnessAlphaClient {
    host;
    onFrame;
    compactionPersistence;
    mode = 'remote';
    questions;
    gateway;
    sessionsCache = new Map();
    selectedModels = new Map();
    followCursors = new Map();
    pendingEvents = new Map();
    events;
    control;
    sessionFollow;
    followGeneration = 0;
    eventClientId;
    eventHostHome;
    constructor(core, host = {}, onFrame, compactionPersistence) {
        this.host = host;
        this.onFrame = onFrame;
        this.compactionPersistence = compactionPersistence;
        this.gateway = new RemoteTypertGateway(core);
        this.questions = new HarnessQuestions(this.gateway, (id, outcome) => this.respondEvent(id, outcome), frame => this.emitFrame(frame));
    }
    start() {
        if (this.events === undefined) {
            const handle = { controller: new AbortController() };
            this.events = handle;
            void this.pumpEvents(handle).catch(error => this.emitStreamFailure(handle, this.events, error));
        }
        if (this.control === undefined) {
            const handle = { controller: new AbortController() };
            this.control = handle;
            void this.pumpControl(handle).catch(error => this.emitStreamFailure(handle, this.control, error));
        }
    }
    async close(notifyRemote = true) {
        ++this.followGeneration;
        this.questions.close(notifyRemote);
        await Promise.all([
            this.closeHandle(this.sessionFollow, notifyRemote),
            this.closeHandle(this.events, notifyRemote),
            this.closeHandle(this.control, notifyRemote),
        ]);
        this.sessionFollow = undefined;
        this.events = undefined;
        this.control = undefined;
        this.pendingEvents.clear();
        this.eventClientId = undefined;
    }
    async sessionList() {
        const result = await this.callValue('session/list', { _request: {} });
        const items = Array.isArray(result.items) ? result.items.map(item => normalizeSession(item)).filter((item) => item !== undefined) : [];
        for (const item of items)
            this.sessionsCache.set(item.sessionId, item);
        return items;
    }
    async sessionCreate(workspaceId, cwd) {
        const result = await this.callValue('session/create', {
            request: workspaceId !== undefined
                ? { workspaceId }
                : cwd !== undefined
                    ? { cwd }
                    : {},
        });
        if (typeof result.sessionId !== 'string') {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session creation result.');
        }
        return result;
    }
    async messageFeedbackList(sessionId) {
        const result = await this.callValue('messageFeedback/list', { request: { sessionId } });
        if (!Array.isArray(result?.items) || result.items.some(item => typeof item?.messageId !== 'string' || typeof item.version !== 'string' || (item.rating !== 'positive' && item.rating !== 'negative')))
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid feedback list.');
        return result.items;
    }
    async messageFeedbackPut(sessionId, messageId, rating) {
        const list = () => this.messageFeedbackList(sessionId);
        const previous = (await list()).find(item => item.messageId === messageId);
        const result = await this.callValue('messageFeedback/put', { request: { sessionId, messageId, rating, ifVersion: previous?.version ?? null } });
        const saved = (await list()).find(item => item.messageId === messageId);
        if (saved?.rating !== rating || typeof saved.version !== 'string' || saved.version !== result?.version)
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Message feedback could not be verified.');
        return saved;
    }
    async sessionFork(sessionId, atSeq) {
        if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || atSeq < 0))
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid fork boundary.');
        const request = atSeq === undefined ? { sessionId } : { sessionId, atSeq };
        const result = await this.callValue('session/fork', { request });
        if (typeof result?.sessionId !== 'string' || result.sessionId.length === 0)
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid fork result.');
        return result;
    }
    async sessionModels(sessionId) {
        const catalog = await this.callValue('session/modelCatalog', {});
        if (typeof catalog.default?.provider !== 'string' || typeof catalog.default?.model !== 'string' || !Array.isArray(catalog.groups)) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid model catalog.');
        }
        const projected = modelSelectionFromSession(this.sessionsCache.get(sessionId));
        const current = this.selectedModels.get(sessionId) ?? projected ?? catalog.default;
        const routable = Array.isArray(catalog.routableProviders)
            ? catalog.routableProviders.includes(current.provider)
            : catalog.groups.length > 0;
        return {
            current,
            routable,
            groups: catalog.groups,
            failures: Array.isArray(catalog.failures) ? catalog.failures : [],
        };
    }
    async sessionSelectModel(sessionId, selection) {
        const result = await this.callValue('session/selectModel', {
            request: {
                sessionId,
                provider: selection.provider,
                model: selection.model,
                ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
            },
        });
        if (typeof result.selected?.provider !== 'string' || typeof result.selected?.model !== 'string') {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid model selection.');
        }
        this.selectedModels.set(sessionId, result.selected);
        return result.selected;
    }
    async sessionExecuteCommand(sessionId, line) {
        // `/compact` inside the official UI is a blocking command by design, but the
        // underlying summarization can outlive any single RPC deadline. When the
        // Host advertises the async contract, run it as a tracked Host operation so
        // only the short submit/status calls cross the wire.
        if (this.supportsAsyncCompaction && line.trim() === '/compact') {
            if (this.compactionPersistence !== undefined) {
                const outcome = await this.compactSessionTracked(sessionId);
                if (outcome.kind === 'unconfirmed')
                    return { kind: 'error', text: outcome.message };
                const status = outcome.status;
                return status.state === 'succeeded'
                    ? { kind: 'success', ...(status.message === undefined ? {} : { text: status.message }) }
                    : { kind: 'error', text: status.message ?? `Compaction ${status.state}.` };
            }
            const status = await this.compactSession(sessionId);
            if (status.state === 'succeeded') {
                return { kind: 'success', ...(status.message === undefined ? {} : { text: status.message }) };
            }
            return { kind: 'error', text: status.message ?? `Compaction ${status.state}.` };
        }
        const execution = await this.callValue('commands/execute', {
            agentId: sessionId, line, ...(this.host.sessionFormat === 3 ? { submittedAttachments: [] } : { images: [] }),
        });
        if (execution === undefined)
            throw new RemoteGatewayError('UNSUPPORTED', 'Unknown or unavailable Host command.');
        if (execution.result?.kind !== 'success' && execution.result?.kind !== 'error')
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Invalid command result.');
        return execution.result;
    }
    /** True when the Host advertises the Remote-owned asynchronous compaction contract. */
    get supportsAsyncCompaction() {
        return this.host.capabilities?.includes(REMOTE_COMPACTION_CAPABILITY) === true;
    }
    /** Submit `/compact` without holding one RPC open for the whole run. */
    async submitCompaction(sessionId, options = {}) {
        return await this.gateway.submitCompaction({
            sessionId,
            requestId: options.requestId ?? createRemoteId(),
            ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
        }, options.signal);
    }
    async compactionStatus(sessionId, operationId, signal) {
        return await this.gateway.compactionStatus({ sessionId, operationId }, signal);
    }
    async cancelCompaction(sessionId, operationId, signal) {
        return await this.gateway.cancelCompaction({ sessionId, operationId }, signal);
    }
    /**
     * Submit (or resume) one compaction and poll until it settles.
     *
     * Polling is observation only. Closing this client, a page or a connection
     * does not abort the Host run: resume by passing the operation id again.
     */
    async compactSession(sessionId, options = {}) {
        let operationId = options.operationId;
        if (operationId === undefined) {
            const submitted = await this.submitCompactionWithRetry(sessionId, options.requestId ?? createRemoteId(), options);
            operationId = submitted.operationId;
            options.onStatus?.({ operationId, sessionId, state: submitted.state });
        }
        return await this.pollCompaction(sessionId, operationId, options);
    }
    /**
     * Product-facing tracked compaction.
     *
     * The requestId is persisted before submission and the operationId as soon as
     * the Host answers, so a lost submit response or a reconnect can query the
     * same Host operation instead of starting a second compaction. Observation
     * failures return `unconfirmed`, never a failure.
     */
    async compactSessionTracked(sessionId, options = {}) {
        const persistence = this.compactionPersistence;
        if (persistence === undefined) {
            return { kind: 'settled', status: await this.compactSession(sessionId, options) };
        }
        const { store, scope } = persistence;
        let record = await safeLoad(store, scope, sessionId);
        if (record === undefined) {
            record = {
                sessionId,
                requestId: options.requestId ?? createRemoteId(),
                state: 'accepted',
                updatedAt: Date.now(),
            };
            await safeSave(store, scope, record);
        }
        let operationId = record.operationId;
        try {
            if (operationId === undefined) {
                // Only recover an in-flight submission. An old record without an
                // operation id may be from before a Host restart (whose dedupe ledger
                // is gone); replaying it would start a new compaction.
                if (record.state !== 'accepted' || Date.now() - record.updatedAt > SUBMIT_RECOVERY_MS) {
                    await safeRemove(store, scope, sessionId);
                    return {
                        kind: 'unconfirmed',
                        message: '上一次压缩提交的结果未知；为避免重复执行，请先确认会话状态。',
                    };
                }
                const submitted = await this.submitCompactionWithRetry(sessionId, record.requestId, options);
                operationId = submitted.operationId;
                record = { ...record, operationId, state: submitted.state, updatedAt: Date.now() };
                await safeSave(store, scope, record);
                options.onStatus?.({ operationId, sessionId, state: submitted.state });
            }
            const boundOperationId = operationId;
            const status = await this.pollCompaction(sessionId, boundOperationId, {
                ...options,
                onStatus: next => {
                    record = { ...record, operationId: boundOperationId, state: next.state, updatedAt: Date.now() };
                    void safeSave(store, scope, record);
                    options.onStatus?.(next);
                },
            });
            record = { ...record, operationId: boundOperationId, state: status.state, updatedAt: Date.now() };
            await safeSave(store, scope, record);
            if (isTerminalCompactionState(status.state)) {
                await safeRemove(store, scope, sessionId);
                return { kind: 'settled', status };
            }
            return { kind: 'unconfirmed', status, message: '压缩仍在收尾，暂时无法确认最终状态。' };
        }
        catch (error) {
            if (isAbortError(error) || options.signal?.aborted === true)
                throw error;
            if (isPermanentCompactionError(error)) {
                await safeRemove(store, scope, sessionId);
                throw error;
            }
            return {
                kind: 'unconfirmed',
                ...(record.operationId === undefined ? {} : { status: statusFromRecord(record) }),
                message: '暂时无法确认压缩状态；重连后会查询同一操作，不会重复发起压缩。',
            };
        }
    }
    /**
     * Ask the Host to cancel the tracked compaction for one Session. Returns
     * undefined when no persisted operation exists (for example a legacy Host or
     * a command that was never tracked).
     */
    async cancelTrackedCompaction(sessionId) {
        const persistence = this.compactionPersistence;
        if (persistence === undefined)
            return undefined;
        const record = await safeLoad(persistence.store, persistence.scope, sessionId);
        if (record?.operationId === undefined)
            return undefined;
        const status = await this.gateway.cancelCompaction({ sessionId, operationId: record.operationId });
        await safeSave(persistence.store, persistence.scope, {
            ...record,
            state: status.state,
            updatedAt: Date.now(),
        });
        if (isTerminalCompactionState(status.state)) {
            await safeRemove(persistence.store, persistence.scope, sessionId);
        }
        return status;
    }
    /** Query every persisted attempt for this Host scope, usually after reconnect. */
    async resumeCompactions(options = {}) {
        const persistence = this.compactionPersistence;
        if (persistence === undefined)
            return [];
        let records = [];
        try {
            records = await persistence.store.list(persistence.scope);
        }
        catch {
            return [];
        }
        const results = [];
        for (const record of records) {
            try {
                const outcome = await this.compactSessionTracked(record.sessionId, { signal: options.signal });
                results.push({ sessionId: record.sessionId, outcome });
                options.onOutcome?.(record.sessionId, outcome);
            }
            catch {
                // A resume must never take the connection down; the record stays for
                // the next reconnect.
            }
        }
        return results;
    }
    async submitCompactionWithRetry(sessionId, requestId, options) {
        let failures = 0;
        for (;;) {
            try {
                return await this.gateway.submitCompaction({
                    sessionId,
                    requestId,
                    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
                }, options.signal);
            }
            catch (error) {
                if (isAbortError(error) || options.signal?.aborted === true || isPermanentCompactionError(error))
                    throw error;
                failures += 1;
                if (failures >= COMPACTION_POLL_RETRIES)
                    throw error;
                await waitFor(500 * failures, options.signal);
            }
        }
    }
    async pollCompaction(sessionId, operationId, options) {
        const signal = options.signal;
        const interval = options.pollIntervalMs ?? COMPACTION_POLL_INTERVAL_MS;
        let consecutiveFailures = 0;
        for (;;) {
            throwIfAborted(signal);
            let status;
            try {
                status = await this.gateway.compactionStatus({ sessionId, operationId }, signal);
                consecutiveFailures = 0;
            }
            catch (error) {
                if (isAbortError(error) || signal?.aborted === true)
                    throw error;
                consecutiveFailures += 1;
                // A lost poll is not a lost operation: back off and ask again, but do
                // not retry a permanent rejection (wrong owner, unknown method, ...).
                if (isTerminalCompactionError(error) || consecutiveFailures >= COMPACTION_POLL_RETRIES)
                    throw error;
                await waitFor(interval * consecutiveFailures, signal);
                continue;
            }
            options.onStatus?.(status);
            if (isTerminalCompactionState(status.state))
                return status;
            await waitFor(interval, signal);
        }
    }
    async sessionSelectPermission(sessionId, preset) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset)) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Harness returned an invalid permission preset.');
        }
        const result = await this.sessionExecuteCommand(sessionId, `/permission ${preset}`);
        if (result.kind === 'error') {
            throw new RemoteGatewayError('COMMAND_FAILED', result.text ?? 'The Host rejected the permission preset.');
        }
    }
    /** Read the Host's agent-preset (mode) roster for the mode picker. */
    async agentPresetList() {
        const result = await this.callValue('agentPresets/list', {});
        const rows = Array.isArray(result.presets) ? result.presets : [];
        return {
            presets: rows.flatMap(row => {
                if (!isRecord(row) || typeof row.id !== 'string' || row.id.length === 0)
                    return [];
                return [{
                        id: row.id,
                        isDefault: row.isDefault === true,
                        ...(typeof row.name === 'string' ? { name: row.name } : {}),
                        ...(typeof row.description === 'string' ? { description: row.description } : {}),
                        ...(typeof row.broken === 'string' ? { broken: row.broken } : {}),
                    }];
            }),
        };
    }
    /** Select the agent preset (mode) of a session that has not started its first turn. */
    async agentPresetSelect(sessionId, agentPreset) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentPreset)) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'Harness returned an invalid agent preset.');
        }
        const committed = await this.callValue('agentPresets/select', { agentId: sessionId, agentPreset });
        return typeof committed === 'string' && committed.length > 0 ? committed : agentPreset;
    }
    /**
     * Official SessionAddress: a subagent session must be addressed through its
     * durable parent (`{ kind: 'subagent', parentSessionId, childSessionId }`);
     * the plain session form is rejected with `session/agent-busy`.
     */
    sessionAddress(sessionId, parentSessionId) {
        return parentSessionId === undefined
            ? { kind: 'session', sessionId }
            : { kind: 'subagent', parentSessionId, childSessionId: sessionId, mode: 'unknown' };
    }
    async sessionHistory(sessionId, beforeSeq, maxMessages = 60, parentSessionId) {
        if (beforeSeq !== undefined) {
            const throughSeq = this.followCursors.get(sessionId) ?? beforeSeq;
            const page = await this.callValue('session/page', {
                request: {
                    address: this.sessionAddress(sessionId, parentSessionId),
                    throughSeq,
                    beforeSeq,
                    maxMessages,
                },
            });
            return {
                events: historyEntriesFromRecords(Array.isArray(page.records) ? page.records : []),
                hasMore: page.hasMore === true,
                throughSeq,
            };
        }
        const generation = ++this.followGeneration;
        await this.closeSessionFollow();
        if (generation !== this.followGeneration)
            throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
        const handle = { sessionId, controller: new AbortController() };
        this.sessionFollow = handle;
        const opened = this.gateway.open('session/follow', {
            args: {
                request: {
                    address: this.sessionAddress(sessionId, parentSessionId),
                    maxMessages,
                    ...(this.host.sessionFormat === 3 ? { assistantStream: true } : {}),
                },
            },
        }, handle.controller.signal);
        const source = await this.boundedFollow(opened, handle);
        handle.stream = source;
        if (this.sessionFollow !== handle || handle.controller.signal.aborted) {
            await this.closeHandle(handle, false);
            throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
        }
        const iterator = source[Symbol.asyncIterator]();
        handle.iterator = iterator;
        // The snapshot can legitimately be slow (a 4 MiB first frame over a weak
        // link): bound it on a separate, generous budget rather than the open RPC's.
        const first = await this.boundedFollow(iterator.next(), handle, 60_000);
        if (this.sessionFollow !== handle || handle.controller.signal.aborted) {
            throw new RemoteGatewayError('CANCELLED', 'The session follow was superseded.');
        }
        if (first.done || !isRecord(first.value) || first.value.type !== 'snapshot') {
            await this.closeSessionFollow();
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session follow snapshot.');
        }
        const snapshot = first.value;
        const cursor = typeof snapshot.cursor === 'number' ? snapshot.cursor : undefined;
        if (cursor !== undefined)
            this.followCursors.set(sessionId, cursor);
        if (this.host.sessionFormat === 3)
            handle.assistant = assistantStreamBaseline(snapshot.assistantStream);
        this.applyProjectionBaseline(sessionId, snapshot.projections);
        this.republishPendingSessionInteractions(sessionId, isRecord(snapshot.projections) && isRecord(snapshot.projections.values) && snapshot.projections.values.userQuestions !== undefined);
        void this.pumpSessionFollow(handle, iterator).catch(error => this.emitStreamFailure(handle, this.sessionFollow, error));
        return {
            events: historyEntriesFromRecords(Array.isArray(snapshot.records) ? snapshot.records : []),
            hasMore: snapshot.hasMore === true,
            ...(cursor === undefined ? {} : { throughSeq: cursor }),
        };
    }
    /** Stage exact file bytes in the receiving Session; only its receipt may be submitted. */
    async sessionUploadFile(sessionId, data, name) {
        return this.callValue('fileUploads/upload', { agentId: sessionId, request: { data, ...(name === undefined ? {} : { name }) } });
    }
    async sessionPrompt(sessionId, text, requestId = createRemoteId(), images = [], files = []) {
        const timeZone = clientTimeZone();
        const content = [
            ...files.map(file => ({ type: 'file', receiptId: file.receiptId })),
            ...(text.length === 0 ? [] : [{ type: 'text', text }]),
            ...images.map(image => ({
                type: 'image',
                mediaType: image.mediaType,
                data: image.data,
                ...(image.name === undefined ? {} : { name: image.name }),
            })),
        ];
        await this.callValue('session/prompt', {
            request: {
                requestId,
                sessionId,
                mode: 'queue',
                content,
                ...(timeZone === undefined ? {} : { clientTimeZone: timeZone }),
            },
        });
    }
    async sessionCancel(sessionId) {
        const result = await this.callValue('session/cancel', { request: { sessionId } });
        if (result.accepted !== true)
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host did not accept the stop request.');
    }
    async sessionAttachment(sessionId, attachment) {
        const reference = typeof attachment === 'string' ? undefined : attachment;
        const attachmentId = typeof attachment === 'string'
            ? attachment
            : typeof attachment.attachmentId === 'string' ? attachment.attachmentId : undefined;
        const result = await this.callValue('session/attachment', {
            request: {
                sessionId,
                ...(attachmentId === undefined ? {} : { attachmentId }),
                ...(reference === undefined ? {} : { attachment: reference }),
            },
        });
        return {
            attachment: result.attachment ?? reference ?? { mediaType: result.mediaType },
            data: result.data ?? '',
        };
    }
    /** Apply one operation to a still-pending queue occurrence (official QueueAction subset). */
    async sessionUpdateQueue(sessionId, itemId, action) {
        const result = await this.callValue('session/updateQueue', { request: { sessionId, itemId, action } });
        if (result.accepted !== true)
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host did not accept the queue update.');
    }
    async hostDescribe() {
        if (this.sessionsCache.size === 0)
            await this.sessionList().catch(() => []);
        const canOpenPath = await this.callValue('session/canOpenWorkspacePath', {}).catch(() => false);
        return {
            version: this.host.harnessVersion ?? this.host.clientVersion ?? 'v0.1.2-rc.1',
            cwd: this.eventHostHome ?? '',
            attachedSessions: this.sessionsCache.size,
            canOpenPath,
        };
    }
    async hostListDirectory(path) {
        const result = await this.callValue('directoryPicker/list', path === undefined ? {} : { path });
        if (typeof result.path !== 'string' || !Array.isArray(result.entries)) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid directory listing.');
        }
        return result;
    }
    async workspaceList() {
        const source = await this.gateway.open('workspace/follow', { args: {} });
        const iterator = source[Symbol.asyncIterator]();
        try {
            const first = await iterator.next();
            if (first.done || !isRecord(first.value) || first.value.type !== 'baseline' || !isRecord(first.value.value)) {
                throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace baseline.');
            }
            return normalizeWorkspaceList(first.value.value);
        }
        finally {
            await iterator.return?.();
        }
    }
    async workspaceCreate(path) {
        const result = await this.callValue('workspace/create', { request: { path } });
        if (typeof result.workspace?.workspaceId !== 'string') {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace.');
        }
        return result;
    }
    async workspaceRename(workspaceId, title) {
        const result = await this.callValue('workspace/rename', { request: { workspaceId, title } });
        if (typeof result.workspace?.workspaceId !== 'string') {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace.');
        }
        return result.workspace;
    }
    async workspaceDelete(workspaceId) {
        await this.callValue('workspace/delete', { request: { workspaceId } });
    }
    async workspaceArchiveSession(sessionId, options) {
        const request = {
            sessionId,
            stopActivity: options?.stopActivity ?? true,
        };
        const result = await this.callValue('workspace/archiveSession', { request });
        return Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : [];
    }
    async workspaceUnarchiveSession(sessionId) {
        const result = await this.callValue('workspace/unarchiveSession', { request: { sessionId } });
        return Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : [];
    }
    async workspacePinSession(sessionId) {
        const result = await this.callValue('workspace/pinSession', { request: { sessionId } });
        return Array.isArray(result.pinnedSessionIds) ? result.pinnedSessionIds : [];
    }
    async workspaceUnpinSession(sessionId) {
        const result = await this.callValue('workspace/unpinSession', { request: { sessionId } });
        return Array.isArray(result.pinnedSessionIds) ? result.pinnedSessionIds : [];
    }
    async sessionRename(sessionId, title) {
        return this.callValue('session/rename', { request: { sessionId, title } });
    }
    async workspaceInsertBefore(workspaceId, beforeWorkspaceId) {
        const result = await this.callValue('workspace/insertBefore', {
            request: {
                workspaceId,
                ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
            },
        });
        return Array.isArray(result.workspaceIds) ? result.workspaceIds : [];
    }
    async scheduleCatalog() {
        const result = await this.callValue('schedule/catalog', {});
        const list = Array.isArray(result)
            ? result
            : result && Array.isArray(result.items)
                ? result.items
                : null;
        if (list === null) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid schedule catalog payload.');
        }
        return list.map(entry => {
            if (typeof entry.sessionId === 'string' && entry.sessionId.length > 0)
                return entry;
            const target = entry.target;
            if (target && typeof target === 'object' && !Array.isArray(target)) {
                const targetObj = target;
                if (targetObj.kind === 'session' && typeof targetObj.sessionId === 'string' && targetObj.sessionId.length > 0) {
                    return { ...entry, sessionId: targetObj.sessionId };
                }
            }
            return entry;
        });
    }
    async scheduleCreate(sessionId, request) {
        return this.callValue('schedule/create', {
            request: { sessionId, ...request },
        });
    }
    async scheduleUpdate(request) {
        return this.callValue('schedule/update', {
            request,
        });
    }
    async scheduleDelete(sessionId, id) {
        return this.callValue('schedule/delete', { request: { sessionId, id } });
    }
    async scheduleHistory(sessionId, id, limit = 20, before) {
        return this.callValue('schedule/history', {
            request: { sessionId, id, limit, ...(before ? { before } : {}) },
        });
    }
    /** Official plugin inventory; the Host hides its own Remote transport rows. */
    async pluginListBundles() {
        const result = await this.callValue('pluginManager/listBundles', {});
        if (!Array.isArray(result))
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid plugin bundle list.');
        return result;
    }
    async pluginListPlugins() {
        const result = await this.callValue('pluginManager/listPlugins', {});
        if (!Array.isArray(result))
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid plugin list.');
        return result;
    }
    /** Switch a bundle (by package name) or one of its rows (by entry id); the Host re-checks its inventory. */
    async pluginSetEnabled(kind, target, enabled) {
        const result = kind === 'bundle'
            ? await this.callValue('pluginManager/setBundleEnabled', { name: target, enabled })
            : await this.callValue('pluginManager/setPluginEnabled', { id: target, enabled });
        if (!isRecord(result) || typeof result.application !== 'string') {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid plugin change result.');
        }
        if (result.application === 'failed') {
            const error = isRecord(result.error) ? result.error : {};
            throw new RemoteGatewayError(typeof error.code === 'string' ? error.code : 'FAILED', typeof error.diagnostic === 'string' && error.diagnostic !== '' ? error.diagnostic : 'The Host could not change the plugin.');
        }
        return { application: result.application };
    }
    async settingsDescribe() {
        const result = await this.callValue('settings/describe', {});
        if (!isRecord(result) || !Array.isArray(result.namespaces)) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned invalid settings.');
        }
        return {
            writable: result.writable !== false,
            namespaces: result.namespaces.filter(isRecord).filter(row => typeof row.ns === 'string')
                .map(row => ({
                ns: row.ns,
                schema: row.schema,
                value: row.value,
                ...(row.user === undefined ? {} : { user: row.user }),
                revision: typeof row.revision === 'number' ? row.revision : 0,
            })),
        };
    }
    /** Path-addressed edits against the revision the form was read at; stale writes are refused by the Host. */
    async settingsMutate(ns, ops, expectedRevision) {
        const result = await this.callValue('settings/mutate', { ns, ops, expectedRevision });
        if (isRecord(result) && result.ok === false) {
            const error = isRecord(result.error) ? result.error : {};
            throw new RemoteGatewayError(typeof error.code === 'string' ? error.code : 'FAILED', typeof error.message === 'string' ? error.message : 'The Host rejected the settings change.');
        }
    }
    async respondApproval(frameRpcId, sessionId, approvalId, outcome) {
        const eventId = this.pendingEvents.has(frameRpcId) ? frameRpcId : approvalId;
        await this.respondEvent(eventId, { kind: 'result', value: outcome });
        this.pendingEvents.delete(eventId);
        this.emitFrame({
            rpcId: '',
            payload: { type: 'approval/resolved', sessionId, approvalId, outcome },
        });
    }
    async respondQuestion(frameRpcId, sessionId, answer) {
        if (await this.questions.answer(frameRpcId, sessionId, answer))
            return;
        await this.respondEvent(frameRpcId, { kind: 'result', value: answer });
        this.pendingEvents.delete(frameRpcId);
        this.emitFrame({
            rpcId: '',
            payload: { type: 'question/resolved', sessionId, questionRpcId: frameRpcId, outcome: 'answered' },
        });
    }
    async respondEvent(eventId, outcome) {
        if (this.eventClientId === undefined) {
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host event stream is not ready.');
        }
        await this.gateway.call('$events/result', {
            args: {
                clientId: this.eventClientId,
                eventId,
                outcome,
            },
        });
    }
    async callValue(endpoint, args, signal) {
        const value = await this.gateway.call(endpoint, { args }, signal);
        if (isRecord(value) && value.ok === true)
            return value.value;
        if (isRecord(value) && value.ok === false && isRecord(value.error)) {
            const error = value.error;
            throw new RemoteGatewayError(typeof error.code === 'string' ? error.code : 'internal', typeof error.message === 'string' ? error.message : 'The Host rejected the Remote request.', isRecord(error.details) ? error.details : {});
        }
        return value;
    }
    async pumpEvents(handle) {
        const source = await this.gateway.open('$events', { args: {} }, handle.controller.signal);
        handle.stream = source;
        const iterator = source[Symbol.asyncIterator]();
        handle.iterator = iterator;
        while (this.events === handle) {
            const next = await iterator.next();
            if (next.done)
                return;
            this.routeEventFrame(next.value);
        }
    }
    async pumpControl(handle) {
        const source = await this.gateway.open('session/control', { args: {} }, handle.controller.signal);
        handle.stream = source;
        const iterator = source[Symbol.asyncIterator]();
        handle.iterator = iterator;
        while (this.control === handle) {
            const next = await iterator.next();
            if (next.done)
                return;
            this.routeControlFrame(next.value);
        }
    }
    async pumpSessionFollow(handle, iterator) {
        while (this.sessionFollow === handle) {
            const next = await iterator.next();
            if (this.sessionFollow !== handle || handle.controller.signal.aborted)
                return;
            if (next.done)
                return;
            for (const entry of this.entriesFromSessionFollow(handle, next.value)) {
                this.emitFrame({
                    rpcId: '',
                    payload: {
                        type: 'session/event',
                        sessionId: handle.sessionId,
                        event: entry.event,
                        ...(entry.view === undefined ? {} : { view: entry.view }),
                    },
                });
            }
        }
    }
    entriesFromSessionFollow(handle, value) {
        if (this.host.sessionFormat !== 3 || !isRecord(value) || value.type !== 'assistant-stream') {
            return entriesFromFollowValue(value);
        }
        const frame = isRecord(value.frame) ? value.frame : undefined;
        if (frame === undefined || typeof frame.type !== 'string')
            return [];
        if (frame.type === 'start') {
            handle.assistant = assistantStreamAttempt(frame, 0);
            return [];
        }
        const attempt = handle.assistant;
        if (frame.type === 'end') {
            if (attempt !== undefined && frame.attemptId === attempt.attemptId)
                handle.assistant = undefined;
            return [];
        }
        if (frame.type !== 'chunk' || attempt === undefined
            || frame.attemptId !== attempt.attemptId
            || frame.index !== attempt.nextIndex
            || typeof frame.time !== 'number'
            || !isRecord(frame.chunk))
            return [];
        attempt.nextIndex += 1;
        return [{
                event: {
                    type: 'assistant/chunk',
                    seq: attempt.startedAfterSeq + 1 - 1 / (attempt.nextIndex + 1),
                    time: frame.time,
                    data: { turn: attempt.turn, step: attempt.step, chunk: frame.chunk },
                },
            }];
    }
    routeEventFrame(value) {
        if (!isRecord(value) || typeof value.type !== 'string')
            return;
        if (value.type === 'ready') {
            this.eventClientId = typeof value.clientId === 'string' ? value.clientId : undefined;
            const host = isRecord(value.host) ? value.host : undefined;
            this.eventHostHome = typeof host?.home === 'string' ? host.home : undefined;
            return;
        }
        if (value.type === 'waterfall' && typeof value.eventId === 'string' && typeof value.agentId === 'string' && isRecord(value.request)) {
            this.routeWaterfall(value.event, value.eventId, value.agentId, value.request);
            return;
        }
        if (value.type === 'cancel' && typeof value.eventId === 'string')
            this.cancelRemoteEvent(value.eventId);
    }
    routeWaterfall(event, eventId, sessionId, request) {
        if (event === 'approval/request') {
            const frame = {
                rpcId: eventId,
                payload: {
                    type: 'approval/requested',
                    sessionId,
                    approvalId: eventId,
                    toolName: typeof request.toolName === 'string' ? request.toolName : 'Harness tool',
                    ...(typeof request.callId === 'string' ? { callId: request.callId } : {}),
                    ...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
                },
            };
            this.pendingEvents.set(eventId, { event, eventId, sessionId, frame });
            this.emitFrame(frame);
            return;
        }
        if (event === 'user-questions/request') {
            if (this.questions.request(sessionId, eventId, request))
                return;
            const frame = {
                rpcId: eventId,
                payload: {
                    type: 'question/requested',
                    sessionId,
                    questions: Array.isArray(request.questions) ? request.questions : [],
                },
            };
            this.pendingEvents.set(eventId, { event, eventId, sessionId, frame });
            this.emitFrame(frame);
        }
    }
    republishPendingSessionInteractions(sessionId, hasUserQuestionsProjection) {
        if (!hasUserQuestionsProjection)
            this.questions.republish(sessionId);
        for (const pending of this.pendingEvents.values()) {
            if (pending.sessionId === sessionId)
                this.emitFrame(pending.frame);
        }
    }
    cancelRemoteEvent(eventId) {
        if (this.questions.cancel(eventId))
            return;
        const pending = this.pendingEvents.get(eventId);
        if (pending === undefined)
            return;
        this.pendingEvents.delete(eventId);
        if (pending.event === 'approval/request') {
            this.emitFrame({
                rpcId: '',
                payload: { type: 'approval/resolved', sessionId: pending.sessionId, approvalId: eventId, outcome: 'cancelled' },
            });
            return;
        }
        this.emitFrame({
            rpcId: '',
            payload: { type: 'question/resolved', sessionId: pending.sessionId, questionRpcId: eventId, outcome: 'cancelled' },
        });
    }
    routeControlFrame(value) {
        if (!isRecord(value) || typeof value.type !== 'string')
            return;
        if (value.type === 'baseline' && isRecord(value.value) && isRecord(value.value.projections)) {
            for (const [sessionId, block] of Object.entries(value.value.projections))
                this.applyProjectionBaseline(sessionId, block);
            return;
        }
        if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string') {
            this.applyProjection(value.sessionId, value.key, value.value, typeof value.seq === 'number' ? value.seq : undefined);
        }
    }
    applyProjectionBaseline(sessionId, block) {
        if (!isRecord(block) || !isRecord(block.values))
            return;
        const seq = typeof block.asOfSeq === 'number' ? block.asOfSeq : undefined;
        const values = normalizeProjectionValues(block.values);
        const cached = this.sessionsCache.get(sessionId);
        if (cached !== undefined) {
            this.sessionsCache.set(sessionId, {
                ...cached,
                projections: { asOfSeq: seq, values: { ...cached.projections?.values, ...values } },
            });
        }
        for (const [key, value] of Object.entries(values))
            this.applyProjection(sessionId, key, value, seq);
    }
    applyProjection(sessionId, key, value, seq) {
        const projectedValue = normalizeProjectionValue(key, value);
        const cached = this.sessionsCache.get(sessionId);
        if (cached !== undefined) {
            this.sessionsCache.set(sessionId, {
                ...cached,
                projections: {
                    asOfSeq: seq ?? cached.projections?.asOfSeq,
                    values: { ...cached.projections?.values, [key]: projectedValue },
                },
            });
        }
        if (key === 'userQuestions')
            this.questions.projection(sessionId, projectedValue, seq);
        if (key === 'modelSelection') {
            const selection = modelSelectionFromValue(projectedValue);
            if (selection !== undefined)
                this.selectedModels.set(sessionId, selection);
        }
        this.emitFrame({
            rpcId: '',
            payload: { type: 'session/projection', sessionId, key, value: projectedValue, ...(seq === undefined ? {} : { seq }) },
        });
    }
    emitStreamFailure(handle, active, error) {
        if (active !== handle || handle.controller.signal.aborted)
            return;
        const failure = this.gateway.failure(error);
        this.emitFrame({ rpcId: '', payload: { type: 'stream/closed', reason: 'failed', error: failure } });
    }
    emitFrame(frame) {
        this.onFrame?.(frame);
    }
    async closeSessionFollow() {
        const follow = this.sessionFollow;
        this.sessionFollow = undefined;
        await this.closeHandle(follow, true);
    }
    /**
     * Bound one phase of opening a session follow. An unanswered open (observed
     * for subagent-parent addresses) must fail loudly instead of hanging the
     * caller's session switch forever.
     */
    async boundedFollow(work, handle, budgetMs = 15_000) {
        // The raced work keeps running after a timeout: attach a sink so its late
        // rejection is never an unhandled promise rejection.
        void work.catch(() => undefined);
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new RemoteGatewayError('STREAM_TIMEOUT', 'The session follow did not open in time.')), budgetMs);
        });
        try {
            return await Promise.race([work, timeout]);
        }
        catch (error) {
            handle.controller.abort();
            throw error;
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    async closeHandle(handle, notifyRemote) {
        if (handle === undefined)
            return;
        if (handle.stream !== undefined) {
            // The close of a live follow can wait on the pump's pending read forever
            // (observed when switching sessions from inside a live conversation),
            // which froze the incoming open in `closeSessionFollow`. Bound it: the
            // abort below is authoritative for local cleanup either way.
            await Promise.race([
                handle.stream.close(notifyRemote).catch(() => undefined),
                new Promise(resolve => setTimeout(resolve, 2_000)),
            ]);
            handle.controller.abort();
            return;
        }
        handle.controller.abort();
    }
}
const COMPACTION_TERMINAL_STATES = new Set([
    'succeeded',
    'failed',
    'cancelled',
    'interrupted',
    'unconfirmed',
]);
const COMPACTION_POLL_INTERVAL_MS = 2_000;
const COMPACTION_POLL_RETRIES = 3;
/** Recover a lost submit response only while the attempt is still fresh. */
const SUBMIT_RECOVERY_MS = 120_000;
function isTerminalCompactionState(state) {
    return COMPACTION_TERMINAL_STATES.has(state);
}
function isPermanentCompactionError(error) {
    const code = error.code;
    return typeof code === 'string' && [
        'FEATURE_NOT_SUPPORTED',
        'METHOD_NOT_FOUND',
        'PERMISSION_DENIED',
        'INVALID_MESSAGE',
        'SESSION_NOT_FOUND',
        'AGENT_BUSY',
        'UNSUPPORTED',
    ].includes(code);
}
function statusFromRecord(record) {
    return {
        operationId: record.operationId ?? '',
        sessionId: record.sessionId,
        state: record.state,
    };
}
async function safeLoad(store, scope, sessionId) {
    try {
        return await store.load(scope, sessionId);
    }
    catch {
        return undefined;
    }
}
async function safeSave(store, scope, record) {
    try {
        await store.save(scope, record);
    }
    catch { }
}
async function safeRemove(store, scope, sessionId) {
    try {
        await store.remove(scope, sessionId);
    }
    catch { }
}
function throwIfAborted(signal) {
    if (signal?.aborted !== true)
        return;
    throw signal.reason instanceof Error
        ? signal.reason
        : new RemoteGatewayError('CANCELLED', 'The compaction observation was cancelled.');
}
function isAbortError(error) {
    if (!(error instanceof Error))
        return false;
    const code = error.code;
    return error.name === 'AbortError' || code === 'RPC_ABORTED' || code === 'CANCELLED';
}
function isTerminalCompactionError(error) {
    const code = error.code;
    return typeof code === 'string' && [
        'FEATURE_NOT_SUPPORTED',
        'METHOD_NOT_FOUND',
        'PERMISSION_DENIED',
        'INVALID_MESSAGE',
        'SESSION_NOT_FOUND',
    ].includes(code);
}
function waitFor(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(signal.reason instanceof Error
                ? signal.reason
                : new RemoteGatewayError('CANCELLED', 'The compaction observation was cancelled.'));
            return;
        }
        let timer;
        const onAbort = () => {
            if (timer !== undefined)
                clearTimeout(timer);
            reject(signal?.reason instanceof Error
                ? signal.reason
                : new RemoteGatewayError('CANCELLED', 'The compaction observation was cancelled.'));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function normalizeSession(value) {
    if (!isRecord(value)
        || typeof value.sessionId !== 'string'
        || typeof value.updatedAt !== 'number'
        || typeof value.running !== 'boolean'
        || typeof value.blank !== 'boolean')
        return undefined;
    const session = value;
    return {
        ...session,
        ...(session.agentPreset === undefined ? {} : { agentPreset: normalizeAgentPreset(session.agentPreset) }),
        ...(session.projections === undefined
            ? {}
            : {
                projections: {
                    ...session.projections,
                    ...(isRecord(session.projections.values)
                        ? { values: normalizeProjectionValues(session.projections.values) }
                        : {}),
                },
            }),
    };
}
function normalizeProjectionValues(values) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, normalizeProjectionValue(key, value)]));
}
function normalizeProjectionValue(key, value) {
    return key === 'agentPreset' ? normalizeAgentPreset(value) : value;
}
function normalizeAgentPreset(value) {
    return value === LEGACY_AGENT_PRESET ? LEGACY_AGENT_PRESET_TARGET : value;
}
function normalizeWorkspaceList(value) {
    return {
        items: Array.isArray(value.items)
            ? value.items.filter(item => isRecord(item) && typeof item.workspaceId === 'string')
            : [],
        archivedSessionIds: Array.isArray(value.archivedSessionIds)
            ? value.archivedSessionIds.filter((item) => typeof item === 'string')
            : [],
        pinnedSessionIds: Array.isArray(value.pinnedSessionIds)
            ? value.pinnedSessionIds.filter((item) => typeof item === 'string')
            : [],
    };
}
function historyEntriesFromRecords(records) {
    return records.flatMap(record => {
        if (!isRecord(record))
            return [];
        if (record.type === 'event' && isRecord(record.event))
            return historyEntryFromEvent(record.event);
        if (record.type === 'chunks' && isRecord(record.event))
            return entriesFromChunkRun(record.event);
        return [];
    });
}
function entriesFromFollowValue(value) {
    if (!isRecord(value))
        return [];
    if (value.type === 'event' && isRecord(value.event))
        return historyEntryFromEvent(value.event);
    if (value.type === 'chunks' && isRecord(value.event))
        return entriesFromChunkRun(value.event);
    return [];
}
function historyEntryFromEvent(event) {
    if (typeof event.type !== 'string' || typeof event.seq !== 'number' || typeof event.time !== 'number')
        return [];
    const surfaceOp = normalizeSurfaceOp(event.surfaceOp);
    return [{
            event: {
                type: event.type,
                seq: event.seq,
                time: event.time,
                data: isRecord(event.data) ? event.data : {},
                ...(Array.isArray(event.sourceEventSeqs) ? { sourceEventSeqs: event.sourceEventSeqs.filter((item) => typeof item === 'number') } : {}),
                ...(surfaceOp === undefined ? {} : { surfaceOp }),
                ...(event.ignorable === true ? { ignorable: true } : {}),
            },
        }];
}
function normalizeSurfaceOp(value) {
    if (value === 'append')
        return value;
    if (!isRecord(value) || value.op !== 'replace')
        return undefined;
    if (typeof value.startSeq === 'number' && typeof value.endSeq === 'number') {
        return { op: 'replace', startSeq: value.startSeq, endSeq: value.endSeq };
    }
    if (typeof value.start === 'number' && typeof value.end === 'number') {
        return { op: 'replace', start: value.start, end: value.end };
    }
    return undefined;
}
function assistantStreamBaseline(value) {
    if (!isRecord(value) || !isRecord(value.activeAttempt))
        return undefined;
    return assistantStreamAttempt(value.activeAttempt);
}
function assistantStreamAttempt(value, defaultNextIndex) {
    const nextIndex = typeof value.nextIndex === 'number' ? value.nextIndex : defaultNextIndex;
    return typeof value.attemptId === 'string'
        && typeof value.startedAfterSeq === 'number'
        && typeof value.turn === 'number'
        && typeof value.step === 'number'
        && nextIndex !== undefined
        ? {
            attemptId: value.attemptId,
            startedAfterSeq: value.startedAfterSeq,
            turn: value.turn,
            step: value.step,
            nextIndex,
        }
        : undefined;
}
function entriesFromChunkRun(event) {
    if (typeof event.type !== 'string' || typeof event.seq !== 'number' || typeof event.time !== 'number' || !isRecord(event.data))
        return [];
    const seq = event.seq;
    const data = event.data;
    const turn = typeof data.turn === 'number' ? data.turn : undefined;
    const step = typeof data.step === 'number' ? data.step : undefined;
    const chunkIndex = typeof data.index === 'number' ? data.index : undefined;
    const base = {
        ...(turn === undefined ? {} : { turn }),
        ...(step === undefined ? {} : { step }),
    };
    const dt = Array.isArray(data.dt) ? data.dt.filter((item) => typeof item === 'number') : [];
    if (event.type === 'chunkrow/text-chunks' || event.type === 'chunkrow/reasoning-chunks') {
        const texts = Array.isArray(data.texts) ? data.texts.filter((item) => typeof item === 'string') : [];
        let time = event.time;
        return texts.map((text, offset) => {
            if (offset > 0)
                time += dt[offset - 1] ?? 0;
            return {
                event: {
                    type: 'assistant/chunk',
                    seq: seq + offset,
                    time,
                    data: {
                        ...base,
                        chunk: {
                            type: event.type === 'chunkrow/text-chunks' ? 'text-delta' : 'reasoning-delta',
                            ...(chunkIndex === undefined ? {} : { index: chunkIndex }),
                            text,
                        },
                    },
                },
            };
        });
    }
    if (event.type !== 'chunkrow/tool-call-chunks')
        return [];
    const args = Array.isArray(data.args) ? data.args.filter((item) => typeof item === 'string') : [];
    let time = event.time;
    return args.map((text, offset) => {
        if (offset > 0)
            time += dt[offset - 1] ?? 0;
        return {
            event: {
                type: 'assistant/chunk',
                seq: seq + offset,
                time,
                data: {
                    ...base,
                    chunk: {
                        type: 'tool-call-delta',
                        ...(chunkIndex === undefined ? {} : { index: chunkIndex }),
                        id: typeof data.id === 'string' ? data.id : undefined,
                        name: typeof data.name === 'string' ? data.name : undefined,
                        argumentsDelta: text,
                    },
                },
            },
        };
    });
}
function modelSelectionFromSession(session) {
    return modelSelectionFromValue(session?.projections?.values?.modelSelection);
}
function modelSelectionFromValue(value) {
    if (!isRecord(value))
        return undefined;
    const candidates = [value.next, value.lastUsed, value];
    for (const candidate of candidates) {
        if (!isRecord(candidate) || typeof candidate.provider !== 'string' || typeof candidate.model !== 'string')
            continue;
        return {
            provider: candidate.provider,
            model: candidate.model,
            ...(typeof candidate.reasoningEffort === 'string' ? { reasoningEffort: candidate.reasoningEffort } : {}),
        };
    }
    return undefined;
}
function clientTimeZone() {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        // The Host only accepts UTC or an IANA "Area/Location" name. Devices that
        // report a bare abbreviation (e.g. "GMT") are rejected at prompt time, so
        // omit the field and let the Host fall back to its own default.
        if (typeof zone !== 'string' || zone.length === 0)
            return undefined;
        if (zone === 'UTC')
            return zone;
        return /^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(zone) ? zone : undefined;
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
