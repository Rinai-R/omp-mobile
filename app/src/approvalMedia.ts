/** Form images never contact an address supplied by the form automatically. */
export function remoteFormImage(src: string): string | undefined {
  const compact = src.trim().replace(/[\u0000-\u0020\u007f]/g, "");
  try {
    const url = new URL(
      compact.startsWith("//") ? `https:${compact}` : compact,
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function svgDataMarkup(uri: string): string | undefined {
  const comma = uri.indexOf(",");
  if (comma < 0 || !/^data:image\/svg\+xml(?:;|,)/i.test(uri)) return undefined;
  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  return /;base64(?:;|$)/i.test(header)
    ? new TextDecoder().decode(
        Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
      )
    : decodeURIComponent(payload);
}

/** Structural subset of react-native-svg's pre-render XmlAST. No renderer imports are needed here. */
export interface SvgTree {
  tag: string;
  props: Record<string, unknown>;
  children: (SvgTree | string)[];
}

export function sanitizeSvgTree<T extends SvgTree>(
  tree: T,
  rewriteSvgData: (uri: string) => string | undefined,
): { tree: T; links: string[] } {
  const links = new Set<string>();
  function visit(node: SvgTree) {
    for (const [name, raw] of Object.entries(node.props)) {
      const key = name.toLowerCase().replace(/[:-]/g, "");
      if (!["href", "xlinkhref", "src", "xmlbase"].includes(key)) continue;
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value.startsWith("#")) continue;
      if (/^data:/i.test(value)) {
        if (/^data:image\/svg\+xml(?:;|,)/i.test(value)) {
          const safe = rewriteSvgData(value);
          if (safe) node.props[name] = safe;
          else delete node.props[name];
        }
        continue;
      }
      const remote = remoteFormImage(value);
      if (remote) links.add(remote);
      delete node.props[name];
    }
    for (const child of node.children)
      if (typeof child !== "string") visit(child);
  }
  visit(tree);
  return { tree, links: [...links] };
}

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/** Serialize a sanitized nested data-SVG before it is handed to an image decoder. */
export function svgTreeMarkup(node: SvgTree): string {
  const attrs = Object.entries(node.props)
    .flatMap(([name, value]) => {
      if (value === undefined || value === null || typeof value === "function")
        return [];
      const text =
        name === "style" && typeof value === "object"
          ? Object.entries(value)
              .map(
                ([key, val]) =>
                  `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${String(val)}`,
              )
              .join(";")
          : String(value);
      return [` ${name}="${escapeXml(text)}"`];
    })
    .join("");
  return `<${node.tag}${attrs}>${node.children.map((child) => (typeof child === "string" ? escapeXml(child) : svgTreeMarkup(child))).join("")}</${node.tag}>`;
}
