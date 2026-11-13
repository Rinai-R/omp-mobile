/**
 * WebRTC transport-level chunking (webrtc-implementation-plan workaround).
 *
 * werift's SCTP `send()` blocks until a whole message is handed to the wire
 * through the slow-start congestion window, which stalls for large messages
 * when the peer is Chromium. To keep every DataChannel message small, large
 * Noise ciphertext frames are split here — *below* the DataChannel, *above*
 * Noise — and transparently reassembled on the other side. The Remote Protocol
 * and Noise semantics are untouched; this layer only changes how ciphertext
 * bytes are framed over the DataChannel.
 *
 * Frame layout (only when the payload exceeds the chunk size):
 *
 *   [0..4)  magic  "RTCH"
 *   [4..8)  messageId  uint32
 *   [8..10) index      uint16
 *   [10..12) total     uint16
 *   [12..)  payload    up to RTC_CHUNK_PAYLOAD_BYTES
 */
export declare const RTC_CHUNK_MAGIC: Uint8Array<ArrayBuffer>;
export declare const RTC_CHUNK_HEADER_BYTES = 12;
export declare const RTC_CHUNK_PAYLOAD_BYTES: number;
export declare const RTC_CHUNK_MAX_MESSAGE_BYTES: number;
export declare class RtcChunkCodec {
    private nextMessageId;
    private readonly assemblies;
    encode(data: Uint8Array): Uint8Array[];
    decode(frame: Uint8Array): Uint8Array | undefined;
    reset(): void;
    private pruneStale;
}
