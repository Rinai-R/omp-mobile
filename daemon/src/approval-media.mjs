import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtmlForm } from "../vendor/omp-form/parse.mjs";
/** Only image references actually present in this pending form are exposed to its paired clients. */
export function approvalImages(request, cwd) {
  if (request.method !== "form" || typeof request.html !== "string")
    return request;
  const images = Object.create(null);
  try {
    for (const section of parseHtmlForm(request.html).sections)
      for (const block of section.blocks) {
        if (block.kind !== "image" || /^(?:https?:|data:)/i.test(block.src))
          continue;
        try {
          const path = block.src.startsWith("file:")
            ? fileURLToPath(block.src)
            : isAbsolute(block.src)
              ? block.src
              : resolve(cwd, block.src);
          const mime = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
          }[extname(path).toLowerCase()];
          if (!mime || statSync(path).size > 8 * 1024 * 1024) continue;
          images[block.src] = {
            type: "image",
            mimeType: mime,
            data: readFileSync(path).toString("base64"),
          };
        } catch {}
      }
  } catch {}
  return Object.keys(images).length ? { ...request, images } : request;
}
