import { memo, useMemo, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type FontVariant } from "react-native";
import { MONO, radius, useStyles, type Palette } from "../theme";

/**
 * A small Markdown renderer for assistant text: paragraphs, headings (# to ###),
 * bullet and numbered lists, block quotes, rules, fenced code blocks, and inline
 * `code`, **bold**, *italic* and [links](url). Anything else stays plain text.
 */

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number; marker: string }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" };

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(marker)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      // An unclosed fence (still streaming) runs to the end of the text.
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = Math.min(3, (heading[1] ?? "#").length) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      flush();
      const ordered = numbered !== null;
      const depth = Math.min(4, Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2));
      const entry = { text: item[3] ?? "", depth, marker: ordered ? `${item[2] ?? "1"}.` : "•" };
      const previous = blocks.at(-1);
      if (previous?.kind === "list" && (previous.ordered === ordered || depth > 0)) previous.items.push(entry);
      else blocks.push({ kind: "list", ordered, items: [entry] });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote !== null) {
      flush();
      const previous = blocks.at(-1);
      if (previous?.kind === "quote") previous.text += `\n${quote[1] ?? ""}`;
      else blocks.push({ kind: "quote", text: quote[1] ?? "" });
      continue;
    }
    // A lazy continuation line of the previous list item.
    const previous = blocks.at(-1);
    if (paragraph.length === 0 && previous?.kind === "list" && /^\s+\S/.test(line)) {
      const last = previous.items.at(-1);
      if (last !== undefined) {
        last.text += ` ${line.trim()}`;
        continue;
      }
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*(?=[^\s*])([\s\S]*?[^\s*])\*|\b_(?=[^\s_])([\s\S]*?[^\s_])_\b/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (match === null) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ kind: "text", text: rest.slice(0, match.index) });
    if (match[2] !== undefined) out.push({ kind: "code", text: match[2].trim() === "" ? match[2] : match[2].trim() });
    else if (match[3] !== undefined || match[4] !== undefined)
      out.push({ kind: "bold", children: parseInline(match[3] ?? match[4] ?? "") });
    else if (match[5] !== undefined) out.push({ kind: "link", url: match[6] ?? "", children: parseInline(match[5]) });
    else out.push({ kind: "italic", children: parseInline(match[7] ?? match[8] ?? "") });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

type Styles = ReturnType<typeof createStyles>;

function openLink(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void Linking.openURL(url).catch(() => undefined);
}

function renderInline(nodes: Inline[], styles: Styles, key = "i"): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}.${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        return (
          <Text key={id} style={styles.inlineCode}>
            {node.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={id} style={styles.bold}>
            {renderInline(node.children, styles, id)}
          </Text>
        );
      case "italic":
        return (
          <Text key={id} style={styles.italic}>
            {renderInline(node.children, styles, id)}
          </Text>
        );
      case "link":
        return (
          <Text key={id} style={styles.link} onPress={() => openLink(node.url)} suppressHighlighting>
            {renderInline(node.children, styles, id)}
          </Text>
        );
      default:
        return null;
    }
  });
}

function CodeBlock({ lang, text, styles }: { lang: string; text: string; styles: Styles }): ReactNode {
  return (
    <View style={styles.codeBox}>
      {lang !== "" ? <Text style={styles.codeLang}>{lang}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText} selectable>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function MarkdownImpl({ text, caret }: { text: string; caret?: ReactNode }): ReactNode {
  const styles = useStyles(createStyles);
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const last = blocks.length - 1;
  // The caret goes at the end of the last text block, or on its own line after code.
  const tailCaret = caret !== undefined && (last < 0 || blocks[last]?.kind === "code" || blocks[last]?.kind === "rule");

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        const trailing = index === last && !tailCaret ? caret : null;
        switch (block.kind) {
          case "paragraph":
            return (
              <Text key={index} style={styles.paragraph} selectable>
                {renderInline(parseInline(block.text), styles)}
                {trailing}
              </Text>
            );
          case "heading":
            return (
              <Text key={index} style={styles[`h${block.level}`]} selectable>
                {renderInline(parseInline(block.text), styles)}
                {trailing}
              </Text>
            );
          case "quote":
            return (
              <View key={index} style={styles.quote}>
                <Text style={styles.quoteText} selectable>
                  {renderInline(parseInline(block.text), styles)}
                  {trailing}
                </Text>
              </View>
            );
          case "rule":
            return <View key={index} style={styles.rule} />;
          case "code":
            return <CodeBlock key={index} lang={block.lang} text={block.text} styles={styles} />;
          case "list":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={[styles.item, { paddingLeft: item.depth * 16 }]}>
                    <Text style={block.ordered ? styles.number : styles.bullet}>{item.marker}</Text>
                    <Text style={styles.itemText} selectable>
                      {renderInline(parseInline(item.text), styles)}
                      {itemIndex === block.items.length - 1 ? trailing : null}
                    </Text>
                  </View>
                ))}
              </View>
            );
          default:
            return null;
        }
      })}
      {tailCaret ? <Text style={styles.paragraph}>{caret}</Text> : null}
    </View>
  );
}

export const Markdown = memo(MarkdownImpl);

function createStyles(c: Palette) {
  const body = { fontSize: 15, lineHeight: 22, color: c.text } as const;
  return {
    root: { gap: 8 },
    paragraph: body,
    h1: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: c.text, marginTop: 4 },
    h2: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: c.text, marginTop: 4 },
    h3: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: c.text, marginTop: 2 },
    bold: { fontWeight: "700" },
    italic: { fontStyle: "italic" },
    link: { color: c.link },
    inlineCode: {
      fontFamily: MONO,
      fontSize: 13,
      color: c.text,
      backgroundColor: c.code,
    },
    list: { gap: 4 },
    item: { flexDirection: "row", gap: 8 },
    bullet: { ...body, width: 14, color: c.textTertiary, textAlign: "center" },
    number: { ...body, minWidth: 18, color: c.textTertiary, fontVariant: ["tabular-nums"] as FontVariant[] },
    itemText: { ...body, flex: 1 },
    quote: { borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 10 },
    quoteText: { ...body, color: c.textSecondary },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 6 },
    codeBox: {
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.code,
      overflow: "hidden",
    },
    codeLang: {
      fontSize: 11,
      lineHeight: 14,
      color: c.textTertiary,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    codeScroll: { paddingHorizontal: 12, paddingVertical: 10 },
    codeText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: c.text },
  } as const;
}
