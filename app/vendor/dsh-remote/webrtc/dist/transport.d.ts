import type { TransportStats } from '@dsh-remote/protocol';
export interface RemoteTransport {
    connect(): Promise<void>;
    send(data: Uint8Array): Promise<void>;
    onMessage(cb: (data: Uint8Array) => void): () => void;
    onClose?(cb: (error?: Error) => void): () => void;
    close(): Promise<void>;
    getStats(): TransportStats;
}
export interface SecureHandshakeTransport extends RemoteTransport {
    markSecureReady?(): void;
    connectionInfo(): {
        connectionId: string;
        localDeviceId: string;
        remoteDeviceId: string;
    };
    sendHandshake(step: number, data: Uint8Array): Promise<void>;
    onHandshake(cb: (step: number, data: Uint8Array) => void): () => void;
}
type MessageHandler = (data: Uint8Array) => void;
export declare abstract class BaseTransport implements RemoteTransport {
    protected handlers: Set<MessageHandler>;
    protected closeHandlers: Set<(error?: Error) => void>;
    onMessage(cb: MessageHandler): () => void;
    onClose(cb: (error?: Error) => void): () => void;
    protected emit(data: Uint8Array): void;
    protected emitClose(error?: Error): void;
    abstract connect(): Promise<void>;
    abstract send(data: Uint8Array): Promise<void>;
    abstract close(): Promise<void>;
    abstract getStats(): TransportStats;
}
export {};
