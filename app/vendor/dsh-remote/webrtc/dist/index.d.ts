import { type TransportStats } from '@dsh-remote/protocol';
import { BaseTransport } from './transport.js';
export * from './transport.js';
export * from './rtc-adapter.js';
export * from './rtc-chunking.js';
export * from './rtc-data-channel.js';
export * from './adaptive-transport.js';
export interface RelayTransportOptions {
    role: 'client';
    deviceId: string;
    accessToken: string;
    targetDeviceId: string;
    capabilities?: string[];
    preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>;
    handshakeTimeoutMs?: number;
}
export declare class RelayTransport extends BaseTransport {
    private readonly url;
    private readonly options;
    private readonly handshakeHandlers;
    private socket?;
    private dataSocket?;
    private bytesSent;
    private bytesReceived;
    private connectionId?;
    private relayCounter;
    private readyResolve?;
    private readyReject?;
    private handshakeTimer?;
    private controlFrameLimits;
    private dataReadyResolve?;
    private dataReadyReject?;
    private dataReady;
    constructor(url: string, options: RelayTransportOptions);
    connect(): Promise<void>;
    send(data: Uint8Array): Promise<void>;
    connectionInfo(): {
        connectionId: string;
        localDeviceId: string;
        remoteDeviceId: string;
    };
    sendHandshake(step: number, data: Uint8Array): Promise<void>;
    onHandshake(cb: (step: number, data: Uint8Array) => void): () => void;
    close(): Promise<void>;
    getStats(): TransportStats;
    private handleSocketMessage;
    private sendControl;
    private openDataSocket;
    private handleDataSocketFrame;
    private finishConnection;
    private failConnection;
    private clearHandshake;
}
export { waitForRelayCapacity } from './websocket-backpressure.js';
export { SerialSend } from './serial-send.js';
export * from './control-lease.js';
