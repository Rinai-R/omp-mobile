export interface ControlLeaseAck {
    connectionId: string;
    requestId: string;
    ticket: string;
    leaseMs: number;
}
/** A connection authorization deadline; socket activity alone never renews it. */
export declare class ControlLease {
    readonly connectionId: string;
    private ticket;
    private readonly request;
    private readonly expired;
    private confirmed;
    private stopped;
    private sent?;
    private deadline?;
    private sequence;
    private timer?;
    private lastRequest;
    constructor(connectionId: string, ticket: string, request: (payload: {
        connectionId: string;
        requestId: string;
        ticket: string;
    }) => void, expired: () => void);
    start(): void;
    valid(): boolean;
    remainingMs(): number | undefined;
    canDetach(): boolean;
    recoveryTicket(): string | undefined;
    tick(force?: boolean): void;
    acknowledge(ack: ControlLeaseAck): void;
    stop(): void;
}
