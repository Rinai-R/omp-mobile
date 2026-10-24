/**
 * OMP's RPC framing, the parts the daemon needs to read protocol v2.
 *
 * Protocol v1 caps every JSON line at 1 MiB; a response above that arrives as
 * `{success: false, error: "RPC response exceeded the transport limit"}`. After
 * `negotiate_protocol` v2, OMP splits a larger frame into `rpc_chunk` lines
 * (base64 slices of the frame's UTF-8 bytes) that reassemble up to 64 MiB.
 * The limits and checks mirror OMP's `rpc-frame.ts` so a frame OMP accepts
 * is one this decoder accepts.
 */

/** Maximum UTF-8 size of one newline-delimited RPC frame, including the newline. */
export const MAX_RPC_FRAME_BYTES = 1024 * 1024;
/** Maximum UTF-8 size of one logical frame reassembled by protocol v2. */
export const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
/** Bytes of the original frame carried by one chunk. */
export const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Whether OMP's `ready` frame offers protocol v2 with the limits this decoder implements.
 * @param {unknown} ready
 */
export function supportsProtocolV2(ready) {
  if (ready === null || typeof ready !== "object") return false;
  const value = /** @type {Record<string, unknown>} */ (ready);
  return (
    value.type === "ready" &&
    Array.isArray(value.supportedProtocolVersions) &&
    value.supportedProtocolVersions.includes(2) &&
    value.maxFrameBytes === MAX_RPC_FRAME_BYTES &&
    value.maxReassembledFrameBytes === MAX_RPC_REASSEMBLED_BYTES
  );
}

/** @param {unknown} data */
function decodeBase64(data) {
  if (typeof data !== "string" || data.length === 0 || !BASE64.test(data)) throw new Error("invalid rpc chunk data");
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) throw new Error("invalid rpc chunk data");
  return bytes;
}

/**
 * Reassembles `rpc_chunk` sequences. Feed it every parsed line in order: a
 * plain frame comes straight back, a chunk returns undefined until its
 * sequence completes, then the reassembled frame. Any violation throws, and
 * the decoder is left empty for the next frame.
 */
export class RpcFrameDecoder {
  /** @type {{chunkId: string, count: number, byteLength: number, nextIndex: number, chunks: Buffer[], receivedBytes: number} | undefined} */
  #pending = undefined;

  /**
   * @param {unknown} value
   * @returns {object | undefined}
   */
  push(value) {
    try {
      return this.#push(value);
    } catch (error) {
      this.#pending = undefined;
      throw error;
    }
  }

  /** @param {unknown} value */
  #push(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("rpc frame must be an object");
    const frame = /** @type {Record<string, unknown>} */ (value);
    if (frame.type !== "rpc_chunk") {
      if (this.#pending !== undefined) throw new Error("rpc chunk sequence interrupted");
      return frame;
    }
    const { chunkId, index, count, byteLength } = frame;
    if (
      typeof chunkId !== "string" ||
      chunkId.length === 0 ||
      chunkId.length > 128 ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(byteLength) ||
      /** @type {number} */ (index) < 0 ||
      /** @type {number} */ (count) < 2 ||
      /** @type {number} */ (count) > Math.ceil(MAX_RPC_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
      /** @type {number} */ (index) >= /** @type {number} */ (count) ||
      /** @type {number} */ (byteLength) < MAX_RPC_FRAME_BYTES ||
      /** @type {number} */ (byteLength) > MAX_RPC_REASSEMBLED_BYTES
    ) {
      throw new Error("invalid rpc chunk metadata");
    }
    const bytes = decodeBase64(frame.data);
    if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error("rpc chunk payload exceeds the transport limit");
    if (this.#pending === undefined) {
      if (index !== 0) throw new Error("rpc chunk sequence must start at index 0");
      this.#pending = { chunkId, count: /** @type {number} */ (count), byteLength: /** @type {number} */ (byteLength), nextIndex: 0, chunks: [], receivedBytes: 0 };
    }
    const pending = this.#pending;
    if (pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index) {
      throw new Error("rpc chunk sequence mismatch");
    }
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex += 1;
    if (pending.receivedBytes > pending.byteLength) throw new Error("rpc chunk sequence exceeds its byte length");
    if (pending.nextIndex < pending.count) return undefined;
    this.#pending = undefined;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("rpc chunk sequence ended short of its byte length");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks, pending.receivedBytes));
    const reassembled = JSON.parse(text);
    if (reassembled === null || typeof reassembled !== "object" || Array.isArray(reassembled)) {
      throw new Error("reassembled rpc frame must be an object");
    }
    if (reassembled.type === "rpc_chunk") throw new Error("reassembled rpc frame must not be a chunk");
    return reassembled;
  }
}

/**
 * Split one frame into the `rpc_chunk` lines OMP v2 writes for it (used by tests and fakes).
 * @param {object} frame
 * @param {string} chunkId
 * @returns {string[]}
 */
export function chunkFrame(frame, chunkId) {
  const bytes = Buffer.from(JSON.stringify(frame), "utf8");
  const count = Math.ceil(bytes.byteLength / RPC_CHUNK_PAYLOAD_BYTES);
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const data = bytes.subarray(index * RPC_CHUNK_PAYLOAD_BYTES, (index + 1) * RPC_CHUNK_PAYLOAD_BYTES).toString("base64");
    lines.push(JSON.stringify({ type: "rpc_chunk", chunkId, index, count, byteLength: bytes.byteLength, data }));
  }
  return lines;
}
