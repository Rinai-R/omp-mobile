import type { ImagePart, Machine } from "./types";

const BLOB_REF = /^blob:sha256:([0-9a-f]{64})$/;

/**
 * What the app can hand to `<Image>` for an OMP image part: a data URI for
 * inline base64, or the daemon's blob route for OMP's content-addressed store.
 */
export function imageUri(machine: Machine, part: ImagePart): string | undefined {
  const blob = BLOB_REF.exec(part.data);
  if (blob !== null) return `${machine.url}/blobs/${blob[1]}?token=${encodeURIComponent(machine.token)}`;
  if (part.data.startsWith("blob:")) return undefined;
  if (part.data.startsWith("data:")) return part.data;
  return `data:${part.mimeType ?? "image/png"};base64,${part.data}`;
}
