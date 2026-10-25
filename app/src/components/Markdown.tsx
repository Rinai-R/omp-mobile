import * as Clipboard from "expo-clipboard";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type FontVariant,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { parseInline, parseMarkdown, type Align, type Block, type Inline, type ListItem } from "../markdown";
import { columnWidths, fitColumns, type Run } from "../tableLayout";
import { t } from "../i18n/index.ts";
import { SANS, MONO, radius, useColors, useStyles, type Palette } from "../theme";
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

/** A cell's inline nodes as runs of text and code, for sizing its column. */
function runs(nodes: readonly Inline[]): Run[] {
  return nodes.flatMap((node): Run[] =>
    node.kind === "text" ? [{ text: node.text }] : node.kind === "code" ? [{ text: `${node.text}  `, mono: true }] : runs(node.children),
  );
}

function openLink(url: string): void {
  const target = /^www\./i.test(url) ? `https://${url}` : url;
  if (/^(https?:|mailto:)/i.test(target)) void Linking.openURL(target).catch(() => undefined);
}

function renderInline(nodes: Inline[], styles: Styles, key = "i", code: Styles["inlineCode"] = styles.inlineCode): ReactNode[] {
  return nodes.map((node, index) => {
    const id = `${key}.${index}`;
    switch (node.kind) {
      case "text":
        return node.text;
      case "code":
        // Thin spaces stand in for padding, which nested text cannot have.
        return (
          <Text key={id} style={code}>
            {`\u2009${node.text}\u2009`}
          </Text>
        );
      case "bold":
        return (
          <Text key={id} style={styles.bold}>
            {renderInline(node.children, styles, id, code)}
          </Text>
        );
      case "italic":
        return (
          <Text key={id} style={styles.italic}>
            {renderInline(node.children, styles, id, code)}
          </Text>
        );
      case "strike":
        return (
          <Text key={id} style={styles.strike}>
            {renderInline(node.children, styles, id, code)}
          </Text>
        );
      case "link":
        return (
          <Text key={id} style={styles.link} onPress={() => openLink(node.url)} accessibilityRole="link" suppressHighlighting>
            {renderInline(node.children, styles, id, code)}
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

/**
 * Space above a block, from what comes before it. One step separates every
 * pair of blocks; a heading takes a step and a half above and hugs what it
 * heads, and a list sits close under the item text it belongs to.
 */
function spaceBefore(block: Block, previous: Block | undefined, ctx: Context): number {
  if (previous === undefined) return 0;
  const { space } = ctx.styles;
  if (ctx.inItem === true && block.kind === "list" && previous.kind === "paragraph") return space.nested;
  if (block.kind === "heading") return space.heading;
  if (previous.kind === "heading") return space.afterHeading;
  return space.block;
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
      {tail !== undefined && !inline ? <Text style={[ctx.styles.paragraph, last >= 0 && { marginTop: ctx.styles.space.nested }]}>{tail}</Text> : null}
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

/**
 * Whether a sideways scroller has more to show past its right edge, and the
 * handlers that keep that up to date.
 */
function useMoreRight() {
  const box = useRef(0);
  const content = useRef(0);
  const x = useRef(0);
  const [more, setMore] = useState(false);
  const update = useCallback(() => setMore(content.current > box.current + 1 && x.current + box.current < content.current - 2), []);
  return {
    more,
    onLayout: useCallback(
      (event: LayoutChangeEvent) => {
        box.current = event.nativeEvent.layout.width;
        update();
      },
      [update],
    ),
    onContentSizeChange: useCallback(
      (width: number) => {
        content.current = width;
        update();
      },
      [update],
    ),
    onScroll: useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        x.current = event.nativeEvent.contentOffset.x;
        update();
      },
      [update],
    ),
  };
}

/** A fade over the right edge of a sideways scroller: there is more this way. */
function EdgeFade({ color, width = 32 }: { color: string; width?: number }): ReactNode {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width }}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.75" stopColor={color} stopOpacity={0.9} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

/**
 * A fenced code block: a soft surface, no title bar. A language, when the
 * fence names one, is a small tag above the code; the copy action sits at the
 * top right either way. Long lines scroll sideways, and a fade at the edge
 * says so.
 */
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
  const scroll = useMoreRight();
  const tagged = lang !== "";
  const button = (
    <Pressable
      onPress={copy}
      hitSlop={8}
      style={({ pressed }) => [styles.copy, pressed && styles.copyPressed]}
      accessibilityRole="button"
      accessibilityLabel={copied ? t("markdown.copied") : t("markdown.copyCode")}
    >
      {copied ? <CheckGlyph size={13} color={colors.ok} /> : <CopyGlyph size={13} color={colors.fgFaint} />}
    </Pressable>
  );
  return (
    <View style={styles.codeBox}>
      {tagged ? (
        <View style={styles.codeHead}>
          <Text style={styles.codeLang} numberOfLines={1}>
            {lang}
          </Text>
          {button}
        </View>
      ) : null}
      <View style={styles.codeBody}>
        <View style={styles.codeLines}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={tagged ? styles.codeScrollTagged : styles.codeScroll}
            onLayout={scroll.onLayout}
            onContentSizeChange={scroll.onContentSizeChange}
            onScroll={scroll.onScroll}
            scrollEventThrottle={32}
          >
            <Text style={styles.codeText} selectable>
              {text === "" ? " " : text}
            </Text>
          </ScrollView>
          {scroll.more ? <EdgeFade color={colors.codeBg} width={24} /> : null}
        </View>
        {tagged ? null : <View style={styles.copyColumn}>{button}</View>}
      </View>
    </View>
  );
}

/**
 * A pipe table, a step smaller than the prose: a quiet header, hairline rules
 * between rows, columns sized to their text within a minimum and a maximum.
 * A wide table scrolls sideways under a fade at its right edge.
 */
function TableBlock({ block, styles }: { block: Extract<Block, { kind: "table" }>; styles: Styles }): ReactNode {
  const colors = useColors();
  const parsed = useMemo(
    () => ({ header: block.header.map((cell) => parseInline(cell)), rows: block.rows.map((row) => row.map((cell) => parseInline(cell))) }),
    [block],
  );
  const widths = useMemo(
    () => columnWidths(parsed.header.map(runs), parsed.rows.map((row) => row.map(runs)), styles.table),
    [parsed, styles],
  );
  const [available, setAvailable] = useState(0);
  const scroll = useMoreRight();
  const onLayout = scroll.onLayout;
  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      setAvailable(Math.round(event.nativeEvent.layout.width));
      onLayout(event);
    },
    [onLayout],
  );
  // The box draws a hairline on both sides; the columns fill what is inside it.
  const sized = fitColumns(widths, available - 2 * StyleSheet.hairlineWidth - 1);
  const align = (column: number): Align => block.aligns[column] ?? "left";
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onLayout={measure}
        onContentSizeChange={scroll.onContentSizeChange}
        onScroll={scroll.onScroll}
        scrollEventThrottle={32}
      >
        <View style={styles.tableBox}>
          <View style={styles.tableHead}>
            {parsed.header.map((cell, column) => (
              <Text key={column} style={[styles.tableHeadCell, { width: sized[column], textAlign: align(column) }]} selectable>
                {renderInline(cell, styles, "c", styles.tableCode)}
              </Text>
            ))}
          </View>
          {parsed.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={rowIndex === 0 ? styles.tableRow : [styles.tableRow, styles.tableRule]}>
              {row.map((cell, column) => (
                <Text key={column} style={[styles.tableCell, { width: sized[column], textAlign: align(column) }]} selectable>
                  {renderInline(cell, styles, "c", styles.tableCode)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {scroll.more ? <EdgeFade color={colors.panel} width={40} /> : null}
    </View>
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
 * Type for a chat on a phone: 15/24 body (1.6, so mixed Chinese and Latin
 * lines do not crowd), headings only a step or two above it in one weight,
 * tables two steps below it and code a little smaller still, in JetBrains Mono.
 * CJK falls back to the system face inside the same line height. Blocks follow
 * one vertical step (`space.block`), headings a step and a half above.
 */
function createStyles(c: Palette, size: number, line: number, quiet: boolean) {
  const fg = quiet ? c.fgFaint : c.fg;
  const body = { fontFamily: SANS, fontSize: size, lineHeight: line, color: fg } as const;
  const heading = { fontFamily: SANS, fontWeight: "600", color: quiet ? c.fgMuted : c.fg } as const;
  const k = size / 15;
  const half = (n: number) => Math.round(n * k * 2) / 2;
  const codeSize = half(12.5);
  const tableSize = half(13);
  const task = {
    width: 15,
    height: 15,
    borderRadius: 4.5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: c.borderStrong,
  } as const;
  const cellPad = { paddingHorizontal: 10, paddingVertical: 6 } as const;
  const copy = { alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: radius.sm + 2 } as const;
  return {
    space: {
      block: Math.round(12 * k),
      heading: Math.round(18 * k),
      afterHeading: Math.round(4 * k),
      nested: Math.round(4 * k),
    },
    digitWidth: Math.round(size * 0.6),
    paragraph: body,
    h1: { ...heading, fontSize: half(17.5), lineHeight: Math.round(25 * k), letterSpacing: -0.2 },
    h2: { ...heading, fontSize: half(16.5), lineHeight: Math.round(24 * k), letterSpacing: -0.1 },
    h3: { ...heading, fontSize: half(15.5), lineHeight: Math.round(23 * k) },
    h4: { ...heading, fontSize: size, lineHeight: line },
    h5: { ...heading, fontSize: size, lineHeight: line, color: quiet ? c.fgFaint : c.fgMuted },
    h6: { ...heading, fontSize: size - 1, lineHeight: line - 2, color: c.fgFaint },
    bold: { fontWeight: "600", color: quiet ? c.fgMuted : c.fg },
    italic: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through", color: c.fgFaint },
    link: { color: c.accent, textDecorationLine: "underline" },
    // A size and a half under the prose and a faint tint: a span, not a block, inside CJK lines.
    inlineCode: { fontFamily: MONO, fontSize: half(13), color: quiet ? c.fgMuted : c.fg, backgroundColor: c.inlineCode },

    list: { gap: Math.round(4 * k) },
    item: { flexDirection: "row" },
    itemBody: { flex: 1, minWidth: 0 },
    bullet: { ...body, color: c.fgGhost, textAlign: "center", marginRight: 4 },
    number: {
      ...body,
      color: c.fgFaint,
      textAlign: "right",
      marginRight: 7,
      fontVariant: ["tabular-nums"] as FontVariant[],
    },
    markerBox: { height: line, justifyContent: "center", alignItems: "flex-start", marginRight: 4 },
    task,
    taskOn: { ...task, borderColor: c.accent, backgroundColor: c.accent },

    quote: { borderLeftWidth: 2, borderLeftColor: c.borderStrong, paddingLeft: 12 },
    quoteText: { ...body, color: quiet ? c.fgGhost : c.fgMuted },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong, marginVertical: Math.round(4 * k) },

    codeBox: {
      borderRadius: radius.md + 2,
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
      paddingLeft: 12,
      paddingRight: 4,
      paddingTop: 4,
    },
    codeLang: { flexShrink: 1, fontFamily: MONO, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.3, color: c.fgFaint },
    copy,
    copyColumn: { paddingTop: 5, paddingRight: 4 },
    copyPressed: { backgroundColor: c.hover },
    codeBody: { flexDirection: "row" },
    codeLines: { flex: 1, minWidth: 0 },
    codeScroll: { paddingLeft: 12, paddingRight: 12, paddingVertical: 10 },
    codeScrollTagged: { paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 10 },
    codeText: { fontFamily: MONO, fontSize: codeSize, lineHeight: Math.round(codeSize * 1.6), color: quiet ? c.fgMuted : c.fg },

    tableCode: { fontFamily: MONO, fontSize: tableSize - 1, color: quiet ? c.fgMuted : c.fg, backgroundColor: c.inlineCode },
    table: {
      minColumn: 52,
      maxColumn: 232,
      // Geist's digits and capitals run near 0.62 em; CJK sets on the full em.
      charWidth: tableSize * 0.62,
      wideWidth: tableSize * 1.04,
      monoWidth: (tableSize - 1) * 0.66,
      // Both paddings and a little slack, so a cell sized to its text never breaks its last character.
      padding: 2 * cellPad.paddingHorizontal + 8,
    },
    tableBox: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderRadius: radius.md,
      backgroundColor: c.panel,
      overflow: "hidden",
    },
    tableHead: {
      flexDirection: "row",
      backgroundColor: c.hover,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderStrong,
    },
    tableRow: { flexDirection: "row" },
    tableRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    tableHeadCell: {
      fontFamily: SANS,
      fontWeight: "500",
      fontSize: tableSize - 0.5,
      lineHeight: Math.round(tableSize * 1.38),
      color: c.fgMuted,
      ...cellPad,
    },
    tableCell: {
      fontFamily: SANS,
      fontSize: tableSize,
      lineHeight: Math.round(tableSize * 1.42),
      color: quiet ? c.fgFaint : c.fg,
      fontVariant: ["tabular-nums"] as FontVariant[],
      ...cellPad,
    },
  } as const;
}

function createReplyStyles(c: Palette) {
  return createStyles(c, 15, 24, false);
}

function createThoughtStyles(c: Palette): Styles {
  return createStyles(c, 13.5, 21, true);
}
