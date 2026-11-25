import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, extname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtmlForm } from "../vendor/omp-form/parse.mjs";

/** Only image references in this form and inside the session/OMP image roots are exposed. */
export function approvalImages(request, cwd, ompBlobDir) {
  if (request.method !== "form" || typeof request.html !== "string")
    return request;
  const roots = [cwd, ompBlobDir].filter(Boolean).flatMap((root) => {
    try {
      return [realpathSync(root)];
    } catch {
      return [];
    }
  });
  const images = Object.create(null);
  try {
    for (const section of parseHtmlForm(request.html).sections)
      for (const block of section.blocks) {
        if (
          block.kind !== "image" ||
          /^(?:https?:|data:|\/\/)/i.test(block.src.trim())
        )
          continue;
        try {
          const candidate = block.src.startsWith("file:")
            ? fileURLToPath(block.src)
            : isAbsolute(block.src)
              ? block.src
              : resolve(cwd, block.src);
          const path = realpathSync(candidate);
          if (
            !roots.some((root) => {
              const rel = relative(root, path);
              return (
                rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
              );
            })
          )
            continue;
          const mime = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
          }[extname(path).toLowerCase()];
          const stat = statSync(path);
          if (!mime || !stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
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
