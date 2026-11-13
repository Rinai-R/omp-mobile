import type { HarnessClientFrame, HarnessQuestionAnswer } from './harness-alpha-client.js';
import { type RemoteTypertGateway } from './remote-gateway.js';
/** Official timed-question claims and durable projection recovery; no requests are replayed. */
export declare class HarnessQuestions {
    private readonly gateway;
    private readonly respondEvent;
    private readonly emit;
    private readonly questions;
    private closed;
    private readonly projectionSeqs;
    constructor(gateway: RemoteTypertGateway, respondEvent: (id: string, outcome: {
        kind: 'result';
        value?: unknown;
    } | {
        kind: 'rejected';
        error: unknown;
    }) => Promise<void>, emit: (frame: HarnessClientFrame) => void);
    request(sessionId: string, eventId: string, request: Record<string, unknown>): boolean;
    cancel(eventId: string): boolean;
    projection(sessionId: string, value: unknown, seq?: number): void;
    answer(id: string, sessionId: string, answer: HarnessQuestionAnswer): Promise<boolean>;
    republish(sessionId: string): void;
    close(notifyRemote: boolean): void;
    private claim;
    private current;
    private publish;
    private release;
}
