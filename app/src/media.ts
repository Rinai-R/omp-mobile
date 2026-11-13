import { relayImage } from "./link.ts";
import type { ImagePart, Machine } from "./types";

const BLOB_REF = /^blob:sha256:([0-9a-f]{64})$/;

/**
 * What the app can hand to `<Image>` for an OMP image part: a data URI for
 * inline base64, or the daemon's blob route for OMP's content-addressed store.
 * Undefined for a blob on a relay machine: `relayImageUri` fetches it.
 */
export function imageUri(machine: Machine, part: ImagePart): string | undefined {
  const blob = BLOB_REF.exec(part.data);
  if (blob !== null) return machine.relay === undefined ? `${machine.url}/blobs/${blob[1]}?token=${encodeURIComponent(machine.token)}` : undefined;
  if (part.data.startsWith("blob:")) return undefined;
  if (part.data.startsWith("data:")) return part.data;
  return `data:${part.mimeType ?? "image/png"};base64,${part.data}`;
}

/** Blobs fetched through relays, by machine and hash; a failed fetch is tried again next time. */
const relayBlobs = new Map<string, Promise<string | undefined>>();

/** A blob image part on a relay machine, as a data URI once fetched through the tunnel. */
export function relayImageUri(machine: Machine, part: ImagePart): Promise<string | undefined> | undefined {
  const blob = BLOB_REF.exec(part.data);
  if (blob === null || machine.relay === undefined) return undefined;
  const key = `${machine.id}\n${blob[1]}`;
  let found = relayBlobs.get(key);
  if (found === undefined) {
    found = relayImage(machine.relay, `/blobs/${blob[1]}`).catch(() => undefined);
    void found.then((uri) => uri === undefined && relayBlobs.delete(key));
    relayBlobs.set(key, found);
  }
  return found;
}
