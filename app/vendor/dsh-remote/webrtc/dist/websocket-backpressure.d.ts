/** Bound Relay buffering without changing the encrypted frame order. Call from serialized data sends. */
export declare function waitForRelayCapacity(socket: {
    readonly readyState: number;
    readonly bufferedAmount?: number;
}): Promise<void>;
