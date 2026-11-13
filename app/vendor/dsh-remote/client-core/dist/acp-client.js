import { AGENT_ACP_TRANSFER_CHUNK_BYTES, MAX_AGENT_ACP_TRANSFER_BYTES, } from '@dsh-remote/protocol';
import { createRemoteId, RemoteGatewayError } from './remote-gateway.js';
/**
 * `session/prompt` blocks until the upstream turn finishes. Keep this well above
 * the default RemoteClientCore timeout (Android uses ~35s for ApiProxy).
 */
export const ACP_PROMPT_RPC_TIMEOUT_MS = 10 * 60_000;
/** Shared Web/Android client for the generic Agent ACP domain in Remote. */
export class AgentAcpClient {
    core;
    capabilities;
    constructor(core, capabilities = []) {
        this.core = core;
        this.capabilities = capabilities;
    }
    supportsArchive(backend) {
        return backend === 'opencode' && this.capabilities.includes('agent.acp.opencode.archive.v1');
    }
    onSessionArchived(handler) {
        return this.core.onEvent(event => {
            if (event.event === 'agent.acp.catalog.changed' && isRecord(event.data) && event.data.backend === 'opencode'
                && event.data.archived === true && typeof event.data.sessionId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(event.data.sessionId))
                handler(event.data);
        });
    }
    async archiveSession(sessionId, backend, signal) {
        if (!this.supportsArchive(backend))
            throw new RemoteGatewayError('OPENCODE_ARCHIVE_UNAVAILABLE', 'Update the Host plugin to support OpenCode native archiving.');
        const result = await this.call('dsh/sessionArchive', { sessionId, backend }, signal);
        if (!isRecord(result) || result.backend !== backend || result.sessionId !== sessionId || result.archived !== true)
            throw new RemoteGatewayError('INVALID_RESPONSE', 'OpenCode did not confirm the session archive state.');
        return result;
    }
    async call(method, params = {}, signal) {
        const timeoutMs = method === 'session/prompt' ? ACP_PROMPT_RPC_TIMEOUT_MS : undefined;
        return this.core.rpc('agent.acp.call', { method, params }, signal, timeoutMs);
    }
    async initialize(params = {}, signal) {
        return this.call('initialize', params, signal);
    }
    async respond(requestHandle, decision, result, signal) {
        return this.core.rpc('agent.acp.respond', {
            requestHandle,
            decision,
            ...(result === undefined ? {} : { result }),
        }, signal);
    }
    async sessionModels(sessionId, backend, signal) {
        return this.call('dsh/sessionModels', { sessionId, backend }, signal);
    }
    async selectModel(sessionId, backend, selection, signal) {
        if (selection.provider !== backend)
            throw new RemoteGatewayError('INVALID_MESSAGE', 'The model provider does not match the ACP backend.');
        if (backend === 'antigravity' && !this.capabilities.includes('agent.acp.antigravity.model-load.v1')) {
            await this.call('session/load', { sessionId, backend }, signal);
        }
        const result = await this.call('dsh/selectModel', { sessionId, backend, model: selection.model,
            ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) }, signal);
        if (!isRecord(result) || !isRecord(result.selected) || result.selected.provider !== backend || typeof result.selected.model !== 'string') {
            throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP did not confirm the selected model.');
        }
        return result.selected;
    }
    async selectPermission(sessionId, backend, preset, signal) {
        return this.call('dsh/selectPermission', { sessionId, backend, preset }, signal);
    }
    async workspaceToolCall(sessionId, backend, endpoint, args, signal) {
        return this.call('dsh/toolCall', { sessionId, backend, endpoint, args }, signal);
    }
    async listWorkspaces(backend, signal) {
        const result = await this.call('dsh/workspaceList', {
            ...(backend === undefined ? {} : { backend }),
        }, signal).catch(error => {
            if (backend === 'pi' || backend === 'claude' || backend === 'hermes')
                throw error;
            return [];
        });
        if ((backend === 'pi' || backend === 'claude' || backend === 'hermes') && !Array.isArray(result)) {
            throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP workspace catalog is invalid.');
        }
        return Array.isArray(result) ? result : [];
    }
    async listSessions(path, backend, limit, signal) {
        const result = await this.call('dsh/sessionList', {
            path,
            ...(backend === undefined ? {} : { backend }),
            ...(limit === undefined ? {} : { limit }),
        }, signal).catch(error => {
            if (backend === 'pi' || backend === 'claude' || backend === 'hermes')
                throw error;
            return { items: [] };
        });
        if ((backend === 'pi' || backend === 'claude' || backend === 'hermes') && (!isRecord(result) || !Array.isArray(result.items))) {
            throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session catalog is invalid.');
        }
        return isRecord(result) && Array.isArray(result.items) ? result.items : [];
    }
    async loadSessionHistory(sessionId, backend, signal) {
        const result = await this.transferCall('dsh/sessionHistory', {
            sessionId,
            ...(backend === undefined ? {} : { backend }),
        }, signal).catch(error => {
            if (backend === 'pi' || backend === 'claude' || backend === 'opencode' || backend === 'hermes')
                throw error;
            return { events: [] };
        });
        if ((backend === 'pi' || backend === 'claude' || backend === 'opencode' || backend === 'hermes') && (!isRecord(result) || !Array.isArray(result.events))) {
            throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session history is invalid.');
        }
        return isRecord(result) && Array.isArray(result.events) ? result.events : [];
    }
    async createSession(cwd, mode, backend, signal) {
        const result = await this.call('session/new', {
            cwd,
            mcpServers: [],
            ...(mode === undefined ? {} : { mode }),
            ...(backend === undefined ? {} : { backend }),
        }, signal);
        const sessionId = readString(result, 'sessionId');
        if (sessionId === undefined)
            throw new RemoteGatewayError('INVALID_RESPONSE', 'ACP session/new did not return sessionId.');
        return {
            sessionId,
            cwd,
            ...(mode === undefined ? {} : { mode }),
        };
    }
    async prompt(sessionId, text, signal, images = [], backend) {
        const params = { sessionId, ...(backend === undefined ? {} : { backend }), prompt: [...(text.length > 0 ? [{ type: 'text', text }] : []), ...images] };
        return images.length > 0 ? this.transferCall('session/prompt', params, signal) : this.call('session/prompt', params, signal);
    }
    async cancel(sessionId, signal) {
        return this.call('session/cancel', { sessionId }, signal);
    }
    async listDirectory(path, signal) {
        return this.call('dsh/directoryList', { path }, signal);
    }
    async openStream(sessionId, onFrame, onClosed, signal, tool) {
        const streamId = createRemoteId();
        const unsubscribe = this.core.onEvent(event => {
            if (event.event === 'agent.acp.frame' && isRecord(event.data)) {
                const data = event.data;
                if (tool ? data.streamId !== streamId : !frameMatchesSubscription(data, streamId, sessionId))
                    return;
                onFrame(data);
            }
            if (event.event === 'agent.acp.stream.closed' && isRecord(event.data) && event.data.streamId === streamId) {
                onClosed?.(event.data);
            }
        });
        try {
            await this.core.rpc('agent.acp.stream.open', { streamId, sessionId, ...(tool ? { tool } : {}) }, signal);
            if (signal?.aborted) {
                unsubscribe();
                await this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined);
                throw signal.reason;
            }
        }
        catch (error) {
            unsubscribe();
            throw error;
        }
        return {
            streamId,
            close: async () => {
                unsubscribe();
                await this.core.rpc('agent.acp.stream.close', { streamId }).catch(() => undefined);
            },
        };
    }
    async transferCall(method, params, signal) {
        const requestBytes = new TextEncoder().encode(JSON.stringify({ method, params }));
        if (requestBytes.byteLength > MAX_AGENT_ACP_TRANSFER_BYTES) {
            throw new RemoteGatewayError('REQUEST_TOO_LARGE', 'The ACP transfer request exceeds the bounded limit.');
        }
        const transferId = createRemoteId();
        const totalChunks = Math.ceil(requestBytes.byteLength / AGENT_ACP_TRANSFER_CHUNK_BYTES);
        try {
            await this.core.rpc('agent.acp.transfer.open', {
                transferId,
                totalBytes: requestBytes.byteLength,
                totalChunks,
            }, signal);
            for (let index = 0; index < totalChunks; index += 1) {
                const start = index * AGENT_ACP_TRANSFER_CHUNK_BYTES;
                const end = Math.min(start + AGENT_ACP_TRANSFER_CHUNK_BYTES, requestBytes.byteLength);
                await this.core.rpc('agent.acp.transfer.chunk', {
                    transferId,
                    index,
                    data: bytesToCanonicalBase64(requestBytes.subarray(start, end)),
                }, signal);
            }
            const commit = await this.core.rpc('agent.acp.transfer.commit', { transferId }, signal, method === 'session/prompt' ? ACP_PROMPT_RPC_TIMEOUT_MS : undefined);
            if (commit.kind === 'inline')
                return commit.response;
            if (commit.kind !== 'chunked' || commit.transferId !== transferId || !Number.isSafeInteger(commit.totalBytes) || commit.totalBytes < 1 || commit.totalBytes > MAX_AGENT_ACP_TRANSFER_BYTES
                || commit.totalChunks !== Math.ceil(commit.totalBytes / AGENT_ACP_TRANSFER_CHUNK_BYTES))
                throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer descriptor.');
            const chunks = [];
            for (let index = 0; index < commit.totalChunks; index += 1) {
                const part = await this.core.rpc('agent.acp.transfer.read', { transferId, index }, signal);
                if (part.transferId !== transferId || part.index !== index || typeof part.data !== 'string' || part.data.length > Math.ceil(AGENT_ACP_TRANSFER_CHUNK_BYTES / 3) * 4)
                    throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer chunk.');
                const chunk = canonicalBase64ToBytes(part.data);
                const expected = Math.min(AGENT_ACP_TRANSFER_CHUNK_BYTES, commit.totalBytes - index * AGENT_ACP_TRANSFER_CHUNK_BYTES);
                if (chunk.length !== expected || bytesToCanonicalBase64(chunk) !== part.data)
                    throw new RemoteGatewayError('INVALID_RESPONSE', 'Invalid ACP transfer chunk size or encoding.');
                chunks.push(chunk);
            }
            const bytes = concat(chunks, commit.totalBytes);
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
        finally {
            await this.core.rpc('agent.acp.transfer.close', { transferId }).catch(() => undefined);
        }
    }
}
function readString(value, key) {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Match Host frames by explicit stream id or by ACP session id (fallback delivery). */
function frameMatchesSubscription(data, streamId, sessionId) {
    if (data.streamId === streamId)
        return true;
    if (data.streamId === sessionScopedStreamId(sessionId))
        return true;
    const params = isRecord(data.frame.params) ? data.frame.params : undefined;
    if (params === undefined)
        return false;
    if (params.sessionId === sessionId)
        return true;
    return isRecord(params.update) && params.update.sessionId === sessionId;
}
export function sessionScopedStreamId(sessionId) {
    return `session:${sessionId}`;
}
function concat(chunks, totalBytes) {
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
function bytesToCanonicalBase64(bytes) {
    let binary = '';
    for (const value of bytes)
        binary += String.fromCharCode(value);
    return btoa(binary);
}
function canonicalBase64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
    return bytes;
}
