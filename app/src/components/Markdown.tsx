import * as Clipboard from "expo-clipboard";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type FontVariant } from "react-native";
import { parseInline, parseMarkdown, plainText, type Align, type Block, type Inline, type ListItem } from "../markdown";
import { t } from "../i18n/index.ts";
import { SANS, MONO, MONO_PLAIN, radius, useColors, useStyles, type Palette } from "../theme";
import { CheckGlyph, CopyGlyph } from "./icons";

/**
 * Renders the blocks `parseMarkdown` produces: a reply's prose at reading size,
 * or (`variant="thought"`) a thought's, smaller and quieter. Blocks render as
 * their own memoized components, so while a reply streams only its last block
 * lays out again.
 */

export type MarkdownVariant = "reply" | "thought";

type Styles = ReturnType<typeof createReplyStyles>;

interface Context {
  styles: Styles;
  /** Inside a block quote: prose takes the quote's quieter colour. */
  quoted: boolean;
  /** Inside a list item: a nested list sits close under the item's text. */
  inItem?: boolean;
}

function openLink(url: string): void {
  const target = /^www\./i.test(url) ? `https://${url}` : url;
  if (/^(https?:|mailto:)/i.test(target)) void Linking.openURL(target).catch(() => undefined);
}

function renderInline(nodes: Inline[], styles: Styles, key = "i"): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}.${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        // Thin spaces stand in for padding, which nested text cannot have.
        return (
          <Text key={id} style={styles.inlineCode}>
            {`\u2009${node.text}\u2009`}
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
      case "strike":
        return (
          <Text key={id} style={styles.strike}>
            {renderInline(node.children, styles, id)}
          </Text>
        );
      case "link":
        return (
          <Text key={id} style={styles.link} onPress={() => openLink(node.url)} accessibilityRole="link" suppressHighlighting>
            {renderInline(node.children, styles, id)}
          </Text>
        );
      default:
        return null;
    }
  });
}

/** Whether the caret can sit at the end of this block's text, rather than on a line after it. */
function endsInText(block: Block | undefined): boolean {
  if (block === undefined) return false;
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return true;
    case "list":
      return endsInText(block.items.at(-1)?.blocks.at(-1));
    case "quote":
      return endsInText(block.blocks.at(-1));
    default:
      return false;
  }
}

/** Space above a block, from what comes before it: tight under headings, more above them. */
function spaceBefore(block: Block, previous: Block | undefined, ctx: Context): number {
  if (previous === undefined) return 0;
  const { space } = ctx.styles;
  if (ctx.inItem === true && block.kind === "list" && previous.kind === "paragraph") return space.nested;
  if (block.kind === "heading") return block.level <= 2 ? space.headingMajor : space.heading;
  if (previous.kind === "heading") return space.afterHeading;
  if (block.kind === "rule" || previous.kind === "rule") return space.rule;
  if (block.kind === "code" || block.kind === "table" || previous.kind === "code" || previous.kind === "table") return space.figure;
  return space.paragraph;
}

function Blocks({ blocks, ctx, tail }: { blocks: Block[]; ctx: Context; tail?: ReactNode }): ReactNode {
  const last = blocks.length - 1;
  const inline = tail !== undefined && endsInText(blocks[last]);
  return (
    <>
      {blocks.map((block, index) => (
        <View key={index} style={index === 0 ? undefined : { marginTop: spaceBefore(block, blocks[index - 1], ctx) }}>
          <BlockView block={block} ctx={ctx} tail={index === last && inline ? tail : undefined} />
        </View>
      ))}
      {tail !== undefined && !inline ? <Text style={[ctx.styles.paragraph, last >= 0 && { marginTop: 4 }]}>{tail}</Text> : null}
    </>
  );
}

function BlockViewImpl({ block, ctx, tail }: { block: Block; ctx: Context; tail?: ReactNode }): ReactNode {
  const { styles } = ctx;
  switch (block.kind) {
    case "paragraph":
      return (
        <Text style={ctx.quoted ? styles.quoteText : styles.paragraph} selectable>
          {renderInline(parseInline(block.text), styles)}
          {tail}
        </Text>
      );
    case "heading":
      return (
        <Text style={styles[`h${block.level}`]} selectable accessibilityRole="header">
          {renderInline(parseInline(block.text), styles)}
          {tail}
        </Text>
      );
    case "quote":
      return (
        <View style={styles.quote}>
          <Blocks blocks={block.blocks} ctx={{ ...ctx, quoted: true }} tail={tail} />
        </View>
      );
    case "rule":
      return <View style={styles.rule} />;
    case "code":
      return <CodeBlock lang={block.lang} text={block.text} styles={styles} />;
    case "table":
      return <TableBlock block={block} styles={styles} />;
    case "list":
      return <ListBlock block={block} ctx={ctx} tail={tail} />;
    default:
      return null;
  }
}

/**
 * A block renders again only when it changed: while a reply streams, the
 * blocks above its last one are equal but new objects, so compare their
 * content (cheap next to laying them out).
 */
const BlockView = memo(
  BlockViewImpl,
  (prev, next) =>
    prev.ctx.styles === next.ctx.styles &&
    prev.ctx.quoted === next.ctx.quoted &&
    prev.ctx.inItem === next.ctx.inItem &&
    prev.tail === next.tail &&
    (prev.block === next.block || JSON.stringify(prev.block) === JSON.stringify(next.block)),
);

const BULLETS = ["•", "◦", "▪"];

function itemCtx(ctx: Context, done: boolean): Context {
  return { ...ctx, inItem: true, quoted: ctx.quoted || done };
}

function ListBlock({ block, ctx, tail }: { block: Extract<Block, { kind: "list" }>; ctx: Context; tail?: ReactNode }): ReactNode {
  const { styles } = ctx;
  const depth = useListDepth();
  const lastNumber = block.start + block.items.length - 1;
  // Wide enough for the longest number, so the items' text lines up.
  const markerWidth = block.ordered ? Math.max(18, String(lastNumber).length * styles.digitWidth + styles.digitWidth) : 16;
  return (
    <ListDepth value={depth + 1}>
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View key={index} style={styles.item}>
            <ItemMarker
              item={item}
              ordered={block.ordered}
              label={block.ordered ? `${block.start + index}.` : (BULLETS[depth % BULLETS.length] ?? "•")}
              width={markerWidth}
              styles={styles}
            />
            <View style={styles.itemBody}>
              <Blocks
                blocks={item.blocks.length === 0 ? [{ kind: "paragraph", text: "" }] : item.blocks}
                ctx={itemCtx(ctx, item.checked === true)}
                tail={index === block.items.length - 1 ? tail : undefined}
              />
            </View>
          </View>
        ))}
      </View>
    </ListDepth>
  );
}

function ItemMarker({
  item,
  ordered,
  label,
  width,
  styles,
}: {
  item: ListItem;
  ordered: boolean;
  label: string;
  width: number;
  styles: Styles;
}): ReactNode {
  const colors = useColors();
  if (item.checked !== undefined) {
    return (
      <View
        style={[styles.markerBox, { width: Math.max(width, 22) }]}
        accessible
        accessibilityLabel={item.checked ? t("markdown.taskDone") : t("markdown.taskOpen")}
      >
        <View style={item.checked ? styles.taskOn : styles.task}>
          {item.checked ? <CheckGlyph size={11} color={colors.accentFg} /> : null}
        </View>
      </View>
    );
  }
  return (
    <Text style={[ordered ? styles.number : styles.bullet, { width }]} importantForAccessibility="no">
      {label}
    </Text>
  );
}

/** How deeply the list being rendered is nested, for its bullet shape. */
const DepthContext = createContext(0);
const ListDepth = DepthContext.Provider;
function useListDepth(): number {
  return useContext(DepthContext);
}

function CodeBlock({ lang, text, styles }: { lang: string; text: string; styles: Styles }): ReactNode {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => undefined);
  }, [text]);
  return (
    <View style={styles.codeBox}>
      <View style={styles.codeHead}>
        <Text style={styles.codeLang} numberOfLines={1}>
          {lang}
        </Text>
        <Pressable
          onPress={copy}
          hitSlop={10}
          style={({ pressed }) => [styles.copy, pressed && styles.copyPressed]}
          accessibilityRole="button"
          accessibilityLabel={copied ? t("markdown.copied") : t("markdown.copyCode")}
        >
          {copied ? <CheckGlyph size={14} color={colors.ok} /> : <CopyGlyph size={14} color={colors.fgFaint} />}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText} selectable>
          {text === "" ? " " : text}
        </Text>
      </ScrollView>
    </View>
  );
}

/** Display columns of `text`: wide (CJK, fullwidth) characters take two. */
function columns(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    count += code >= 0x1100 && /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u.test(char) ? 2 : 1;
  }
  return count;
}

/** A pipe table: a tinted header, hairline rows, columns sized to their text, scrolling sideways when wide. */
function TableBlock({ block, styles }: { block: Extract<Block, { kind: "table" }>; styles: Styles }): ReactNode {
  const parsed = useMemo(
    () => ({ header: block.header.map((cell) => parseInline(cell)), rows: block.rows.map((row) => row.map((cell) => parseInline(cell))) }),
    [block],
  );
  const widths = useMemo(
    () =>
      parsed.header.map((head, column) => {
        const longest = Math.max(
          columns(plainText(head)) * 1.08,
          ...parsed.rows.map((row) => columns(plainText(row[column] ?? []))),
        );
        return Math.round(Math.min(styles.table.maxColumn, Math.max(styles.table.minColumn, longest * styles.table.charWidth + 24)));
      }),
    [parsed, styles],
  );
  // A narrow table spreads its columns over the width it has.
  const [available, setAvailable] = useState(0);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const scale = available > total + 2 && total > 0 ? (available - 2) / total : 1;
  const sized = scale === 1 ? widths : widths.map((width) => Math.floor(width * scale));
  const align = (column: number): Align => block.aligns[column] ?? "left";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      onLayout={(event) => setAvailable(Math.round(event.nativeEvent.layout.width))}
    >
      <View style={styles.tableBox}>
        <View style={styles.tableHead}>
          {parsed.header.map((cell, column) => (
            <Text key={column} style={[styles.tableHeadCell, { width: sized[column], textAlign: align(column) }]} selectable>
              {renderInline(cell, styles)}
            </Text>
          ))}
        </View>
        {parsed.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, column) => (
              <Text key={column} style={[styles.tableCell, { width: sized[column], textAlign: align(column) }]} selectable>
                {renderInline(cell, styles)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MarkdownImpl({ text, caret, variant = "reply" }: { text: string; caret?: ReactNode; variant?: MarkdownVariant }): ReactNode {
  const styles = useStyles(variant === "thought" ? createThoughtStyles : createReplyStyles);
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const ctx = useMemo<Context>(() => ({ styles, quoted: false }), [styles]);
  return (
    <View>
      <Blocks blocks={blocks} ctx={ctx} tail={caret} />
    </View>
  );
}

export const Markdown = memo(MarkdownImpl);

/**
 * Type for reading on a phone: 16/26 body (a generous 1.6 that keeps mixed
 * Chinese and Latin lines from crowding), headings stepped down from 21 in
 * one weight, code at 13 in JetBrains Mono. CJK falls back to the system face
 * inside the same line height.
 */
function createStyles(c: Palette, size: number, line: number, quiet: boolean) {
  const fg = quiet ? c.fgFaint : c.fg;
  const body = { fontFamily: SANS, fontSize: size, lineHeight: line, color: fg } as const;
  const heading = { fontFamily: SANS, fontWeight: "600", color: quiet ? c.fgMuted : c.fg } as const;
  const k = size / 16;
  const codeSize = Math.round(12.5 * k * 2) / 2;
  const task = {
    width: 16,
    height: 16,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: c.borderStrong,
  } as const;
  return {
    space: {
      paragraph: Math.round(12 * k),
      heading: Math.round(18 * k),
      headingMajor: Math.round(24 * k),
      afterHeading: Math.round(6 * k),
      figure: Math.round(14 * k),
      rule: Math.round(18 * k),
      nested: Math.round(4 * k),
    },
    digitWidth: Math.round(size * 0.6),
    paragraph: body,
    h1: { ...heading, fontSize: Math.round(21 * k), lineHeight: Math.round(29 * k), letterSpacing: -0.4 },
    h2: { ...heading, fontSize: Math.round(19 * k), lineHeight: Math.round(27 * k), letterSpacing: -0.3 },
    h3: { ...heading, fontSize: Math.round(17 * k), lineHeight: Math.round(25 * k), letterSpacing: -0.2 },
    h4: { ...heading, fontSize: size, lineHeight: line },
    h5: { ...heading, fontSize: size - 1, lineHeight: line - 2, color: quiet ? c.fgFaint : c.fgMuted },
    h6: { ...heading, fontSize: size - 1, lineHeight: line - 2, fontWeight: "500", color: c.fgFaint },
    bold: { fontWeight: "600", color: quiet ? c.fgMuted : c.fg },
    italic: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through", color: c.fgFaint },
    link: { color: c.accent, textDecorationLine: "underline" },
    // Two sizes under the prose and a faint tint: a span, not a block, inside CJK lines.
    inlineCode: { fontFamily: MONO, fontVariant: MONO_PLAIN, fontSize: size - 2, color: quiet ? c.fgMuted : c.fg, backgroundColor: c.inlineCode },

    list: { gap: Math.round(6 * k) },
    item: { flexDirection: "row" },
    itemBody: { flex: 1, minWidth: 0 },
    bullet: { ...body, color: c.fgFaint, textAlign: "center", marginRight: 6 },
    number: {
      ...body,
      color: c.fgFaint,
      textAlign: "right",
      marginRight: 8,
      fontVariant: ["tabular-nums"] as FontVariant[],
    },
    markerBox: { height: line, justifyContent: "center", alignItems: "flex-start", marginRight: 6 },
    task,
    taskOn: { ...task, borderColor: c.accent, backgroundColor: c.accent },

    quote: { borderLeftWidth: 3, borderLeftColor: c.borderStrong, paddingLeft: 12, paddingVertical: 1 },
    quoteText: { ...body, color: quiet ? c.fgGhost : c.fgFaint },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },

    codeBox: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.codeBg,
      overflow: "hidden",
    },
    codeHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 32,
      paddingLeft: 12,
      paddingRight: 6,
      backgroundColor: c.codeHead,
    },
    codeLang: { flexShrink: 1, fontFamily: MONO, fontVariant: MONO_PLAIN, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    copy: { alignItems: "center", justifyContent: "center", width: 30, height: 26, borderRadius: radius.sm },
    copyPressed: { backgroundColor: c.hover },
    codeScroll: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
    codeText: { fontFamily: MONO, fontVariant: MONO_PLAIN, fontSize: codeSize, lineHeight: Math.round(codeSize * 1.55), color: quiet ? c.fgMuted : c.fg },

    table: { minColumn: 72, maxColumn: 280, charWidth: (size - 2) * 0.6 },
    tableBox: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderRadius: radius.md,
      overflow: "hidden",
    },
    tableHead: { flexDirection: "row", backgroundColor: c.codeHead },
    tableRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    tableHeadCell: {
      fontFamily: SANS,
      fontWeight: "600",
      fontSize: size - 2,
      lineHeight: line - 6,
      color: quiet ? c.fgMuted : c.fg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    tableCell: {
      fontFamily: SANS,
      fontSize: size - 2,
      lineHeight: line - 5,
      color: quiet ? c.fgFaint : c.fgMuted,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
  } as const;
}

function createReplyStyles(c: Palette) {
  return createStyles(c, 16, 26, false);
}

function createThoughtStyles(c: Palette): Styles {
  return createStyles(c, 14, 22, true);
}
