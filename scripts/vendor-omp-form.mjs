/** Refresh the pure OMP form core from an installed, pinned upstream package. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const upstream = process.argv[2] ?? resolve(root, "node_modules/@oh-my-pi");
const files = {
  "dom.ts": "pi-utils/src/dom.ts",
  "dom/core.ts": "pi-utils/src/dom/core.ts",
  "dom/parser.ts": "pi-utils/src/dom/parser.ts",
  "dom/selector.ts": "pi-utils/src/dom/selector.ts",
  "parse.ts": "pi-tui/src/html-form/parse.ts",
  "data.ts": "pi-tui/src/html-form/data.ts",
};
const hashes = {};
for (const [target, source] of Object.entries(files)) {
  const original = readFileSync(resolve(upstream, source), "utf8");
  hashes[source] = createHash("sha256").update(original).digest("hex");
  let text = original
    .replace('from "@oh-my-pi/pi-utils/dom"', 'from "./dom.ts"')
    .replace(
      'import type { ImageContent } from "@oh-my-pi/pi-ai";',
      "type ImageContent = unknown;",
    );
  text = text.replace(
    /export const enum (\w+) \{([\s\S]*?)\n\}/g,
    (_, name, body) =>
      `export const ${name} = {${body.replace(/(\w+)\s*=\s*(\d+)/g, "$1: $2")}\n} as const;`,
  );
  text = text.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (_, a, b, c) => a + b.replace(/\.ts$/, "") + ".ts" + c,
  );
  text =
    "// @ts-nocheck\n// Vendored MIT code. See LICENSE and SOURCE.json; regenerate with scripts/vendor-omp-form.mjs.\n" +
    text;
  const app = resolve(root, "app/vendor/omp-form", target);
  mkdirSync(dirname(app), { recursive: true });
  writeFileSync(app, text);
  const daemon = resolve(
    root,
    "daemon/vendor/omp-form",
    target.replace(/\.ts$/, ".mjs"),
  );
  mkdirSync(dirname(daemon), { recursive: true });
  writeFileSync(
    daemon,
    ts
      .transpileModule(text, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      })
      .outputText.replace(/\.ts(["'])/g, ".mjs$1"),
  );
}
const license = readFileSync(resolve(upstream, "pi-tui/LICENSE"), "utf8");
const source =
  JSON.stringify(
    {
      repository: "https://github.com/can1357/oh-my-pi",
      version: JSON.parse(
        readFileSync(resolve(upstream, "pi-tui/package.json")),
      ).version,
      files: hashes,
      adaptations: [
        "relative imports",
        "erased image-only type import",
        "daemon JavaScript transpilation",
        "enum converted to an equivalent erasable constant object",
      ],
    },
    null,
    2,
  ) + "\n";
for (const dest of ["app/vendor/omp-form", "daemon/vendor/omp-form"]) {
  writeFileSync(resolve(root, dest, "LICENSE"), license);
  writeFileSync(resolve(root, dest, "SOURCE.json"), source);
}
writeFileSync(
  resolve(root, "app/vendor/omp-form/license.json"),
  JSON.stringify({ text: license }) + "\n",
);
