/** Serialize encryption with transmission, bounded even when the transport stalls. */
export declare class SerialSend {
    private tail;
    private bytes;
    private count;
    run(bytes: number, send: () => Promise<void>): Promise<void>;
}
