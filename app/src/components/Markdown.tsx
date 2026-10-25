import * as Clipboard from "expo-clipboard";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Linking,
  PixelRatio,
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
import { columnWidths, type Run } from "../tableLayout";
import { t } from "../i18n/index.ts";
import { SANS, MONO, SCALE, radius, useColors, useStyles, type Palette } from "../theme";
import { CheckGlyph, CopyGlyph, WrapGlyph } from "./icons";

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
  /** Inside a block quote. */
  quoted: boolean;
  /** Inside a done task: prose takes a quieter colour. */
  dim?: boolean;
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
  if (block.kind === "rule" || previous.kind === "rule") return space.rule;
  if (block.kind === "heading") return block.level <= 3 ? space.heading : space.block;
  if (previous.kind === "heading") return block.kind === "list" && previous.level >= 4 ? space.nested * 2 : space.afterHeading;
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
      {tail !== undefined && !inline ? (
        <Text style={[ctx.styles.paragraph, last >= 0 && { marginTop: ctx.styles.space.nested }]} maxFontSizeMultiplier={ctx.styles.scale.body}>
          {tail}
        </Text>
      ) : null}
    </>
  );
}

function BlockViewImpl({ block, ctx, tail }: { block: Block; ctx: Context; tail?: ReactNode }): ReactNode {
  const { styles } = ctx;
  switch (block.kind) {
    case "paragraph":
      return (
        <Text style={ctx.dim === true ? styles.dimText : styles.paragraph} selectable maxFontSizeMultiplier={styles.scale.body}>
          {renderInline(parseInline(block.text), styles)}
          {tail}
        </Text>
      );
    case "heading":
      return (
        <Text style={styles[`h${block.level}`]} selectable accessibilityRole="header" maxFontSizeMultiplier={styles.scale.heading}>
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
    prev.ctx.dim === next.ctx.dim &&
    prev.tail === next.tail &&
    (prev.block === next.block || JSON.stringify(prev.block) === JSON.stringify(next.block)),
);

const BULLETS = ["•", "◦", "▪"];

function itemCtx(ctx: Context, done: boolean): Context {
  return { ...ctx, inItem: true, dim: ctx.dim === true || done };
}

function ListBlock({ block, ctx, tail }: { block: Extract<Block, { kind: "list" }>; ctx: Context; tail?: ReactNode }): ReactNode {
  const { styles } = ctx;
  const depth = useListDepth();
  const lastNumber = block.start + block.items.length - 1;
  // Wide enough for the longest number at the current text size, so the items' text lines up;
  // a minimum, not a width, so a larger font grows the column instead of wrapping "10.".
  const scale = Math.min(Math.max(1, PixelRatio.getFontScale()), styles.scale.body);
  const markerWidth = block.ordered ? Math.ceil(Math.max(18, (String(lastNumber).length + 1) * styles.digitWidth * scale + 4)) : 18;
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
          {item.checked ? <CheckGlyph size={11} color={colors.bg} /> : null}
        </View>
      </View>
    );
  }
  return (
    <Text style={[ordered ? styles.number : styles.bullet, { minWidth: width }]} numberOfLines={1} importantForAccessibility="no" maxFontSizeMultiplier={styles.scale.body}>
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
 * A fenced code block: a soft rounded panel. Its header, on the same fill,
 * names the language (or just "Code") and holds a wrap toggle and copy. Lines
 * wrap by default; unwrapped they scroll sideways under a fade at the edge.
 */
function CodeBlock({ lang, text, styles }: { lang: string; text: string; styles: Styles }): ReactNode {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(() => {
    void Clipboard.setStringAsync(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1_200);
      })
      .catch(() => undefined);
  }, [text]);
  const scroll = useMoreRight();
  const code = (
    <Text style={styles.codeText} selectable maxFontSizeMultiplier={styles.scale.code}>
      {text === "" ? " " : text}
    </Text>
  );
  return (
    <View style={styles.codeBox}>
      <View style={styles.codeHead}>
        <Text style={styles.codeLang} numberOfLines={1} maxFontSizeMultiplier={SCALE.ui}>
          {lang !== "" ? lang : t("markdown.code")}
        </Text>
        <Pressable
          onPress={() => setWrap((value) => !value)}
          hitSlop={6}
          style={({ pressed }) => [wrap ? styles.codeButtonOn : styles.codeButton, pressed && styles.codeButtonPressed]}
          accessibilityRole="switch"
          accessibilityState={{ checked: wrap }}
          accessibilityLabel={t("markdown.wrap")}
        >
          <WrapGlyph size={14} color={wrap ? colors.fgMuted : colors.fgFaint} />
        </Pressable>
        <Pressable
          onPress={copy}
          hitSlop={6}
          style={({ pressed }) => [styles.codeButton, pressed && styles.codeButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={copied ? t("markdown.copied") : t("markdown.copyCode")}
        >
          {copied ? <CheckGlyph size={14} color={colors.ok} /> : <CopyGlyph size={14} color={colors.fgFaint} />}
        </Pressable>
      </View>
      {wrap ? (
        <View style={styles.codeWrapped}>{code}</View>
      ) : (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.codeScroll}
            onLayout={scroll.onLayout}
            onContentSizeChange={scroll.onContentSizeChange}
            onScroll={scroll.onScroll}
            scrollEventThrottle={32}
          >
            {code}
          </ScrollView>
          {scroll.more ? <EdgeFade color={colors.codeBg} width={24} /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * A pipe table, a step smaller than the prose: horizontal hairlines only (a
 * firmer one under the header), roomy cells, the first and last columns flush
 * with the prose. Columns take their text's width within a minimum and a
 * maximum, and a wide table scrolls sideways under a fade at its right edge.
 */
function TableBlock({ block, styles }: { block: Extract<Block, { kind: "table" }>; styles: Styles }): ReactNode {
  const colors = useColors();
  const parsed = useMemo(
    () => ({ header: block.header.map((cell) => parseInline(cell)), rows: block.rows.map((row) => row.map((cell) => parseInline(cell))) }),
    [block],
  );
  const widths = useMemo(() => {
    // The text grows with the system font size up to the table's cap; so do the columns.
    const k = Math.min(Math.max(1, PixelRatio.getFontScale()), styles.scale.table);
    const metrics = {
      ...styles.table,
      charWidth: styles.table.charWidth * k,
      wideWidth: styles.table.wideWidth * k,
      monoWidth: styles.table.monoWidth * k,
      maxColumn: styles.table.maxColumn * k,
    };
    const natural = columnWidths(parsed.header.map(runs), parsed.rows.map((row) => row.map(runs)), metrics);
    // The outer columns drop their outer padding.
    return natural.map((width, column) => width - (column === 0 ? styles.table.side : 0) - (column === natural.length - 1 ? styles.table.side : 0));
  }, [parsed, styles]);
  const scroll = useMoreRight();
  const align = (column: number): Align => block.aligns[column] ?? "left";
  const last = parsed.header.length - 1;
  const cell = (column: number) => [
    { width: widths[column], textAlign: align(column) },
    column === 0 && styles.cellFirst,
    column === last && styles.cellLast,
  ];
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled
        onLayout={scroll.onLayout}
        onContentSizeChange={scroll.onContentSizeChange}
        onScroll={scroll.onScroll}
        scrollEventThrottle={32}
      >
        <View>
          <View style={styles.tableHead}>
            {parsed.header.map((value, column) => (
              <Text key={column} style={[styles.tableHeadCell, ...cell(column)]} selectable maxFontSizeMultiplier={styles.scale.table}>
                {renderInline(value, styles, "c", styles.tableCode)}
              </Text>
            ))}
          </View>
          {parsed.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.tableRow}>
              {row.map((value, column) => (
                <Text key={column} style={[styles.tableCell, ...cell(column)]} selectable maxFontSizeMultiplier={styles.scale.table}>
                  {renderInline(value, styles, "c", styles.tableCode)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {scroll.more ? <EdgeFade color={colors.bg} width={40} /> : null}
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
 * Type for a chat on a phone: 15/24 prose (mixed Chinese and Latin lines need
 * the room), headings in one weight a few steps above it with generous space
 * over them, list items close together, tables two steps below the prose and
 * code smaller still, in JetBrains Mono. `quiet` is a thought's compact form:
 * 13/20 and grey, its headings only bold.
 */
function createStyles(c: Palette, quiet: boolean) {
  const size = quiet ? 13 : 15;
  const line = quiet ? 20 : 24;
  const fg = quiet ? c.fgFaint : c.fg;
  const body = { fontFamily: SANS, fontSize: size, lineHeight: line, color: fg } as const;
  const heading = { fontFamily: SANS, fontWeight: "600", color: quiet ? c.fgMuted : c.fg } as const;
  const minor = { ...heading, fontSize: size, lineHeight: line } as const;
  const tableSize = quiet ? 12 : 13;
  const side = quiet ? 8 : 16;
  const task = {
    width: 15,
    height: 15,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: c.fgGhost,
  } as const;
  const cell = { paddingHorizontal: side, paddingVertical: quiet ? 4 : 10 } as const;
  const button = { alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: radius.sm } as const;
  return {
    scale: quiet
      ? { body: SCALE.meta, heading: SCALE.meta, table: SCALE.meta, code: SCALE.code }
      : { body: SCALE.body, heading: SCALE.heading, table: SCALE.table, code: SCALE.code },
    space: quiet
      ? { block: 6, heading: 10, afterHeading: 4, nested: 4, rule: 10 }
      : { block: 14, heading: 28, afterHeading: 12, nested: 4, rule: 28 },
    digitWidth: Math.round(size * 0.6),
    paragraph: body,
    dimText: { ...body, color: c.fgFaint },
    h1: quiet ? minor : { ...heading, fontSize: 22, lineHeight: 31, letterSpacing: -0.2 },
    h2: quiet ? minor : { ...heading, fontSize: 20, lineHeight: 29, letterSpacing: -0.2 },
    h3: quiet ? minor : { ...heading, fontSize: 18, lineHeight: 27 },
    h4: minor,
    h5: minor,
    h6: minor,
    bold: { fontWeight: "600", color: quiet ? c.fgMuted : c.fg },
    italic: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through", color: c.fgFaint },
    link: quiet
      ? ({ color: c.fgMuted, textDecorationLine: "underline", textDecorationStyle: "dotted" } as const)
      : ({ color: c.accentB, fontWeight: "500" } as const),
    // A light pill in prose (nested text cannot have padding: thin spaces stand in for it).
    inlineCode: { fontFamily: MONO, fontSize: quiet ? 12 : (13 as number), color: quiet ? c.fgMuted : c.fg, backgroundColor: c.inlineCode },

    list: { gap: quiet ? 2 : 6 },
    item: { flexDirection: "row" },
    itemBody: { flex: 1, minWidth: 0 },
    bullet: { ...body, flexShrink: 0, color: c.fgMuted, textAlign: "left" },
    number: {
      ...body,
      flexShrink: 0,
      paddingRight: 4,
      color: c.fgMuted,
      textAlign: "left",
      fontVariant: ["tabular-nums"] as FontVariant[],
    },
    markerBox: { height: line, justifyContent: "center", alignItems: "flex-start" },
    task,
    taskOn: { ...task, borderColor: c.fgMuted, backgroundColor: c.fgMuted },

    quote: { borderLeftWidth: 2, borderLeftColor: c.fgGhost, paddingLeft: 14 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.borderStrong },

    codeBox: {
      borderRadius: radius.lg,
      backgroundColor: c.codeBg,
      // On the light page the panel is white: a hairline keeps it from melting into the page.
      borderWidth: c.dark ? 0 : StyleSheet.hairlineWidth,
      borderColor: c.border,
      overflow: "hidden",
    },
    codeHead: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, paddingLeft: 16, paddingRight: 6, paddingTop: 2 },
    codeLang: { flex: 1, fontFamily: MONO, fontSize: 11, lineHeight: 16, color: c.fgFaint },
    codeButton: button,
    codeButtonOn: button,
    codeButtonPressed: { backgroundColor: c.hover },
    codeWrapped: { paddingTop: 2, paddingHorizontal: 16, paddingBottom: 16 },
    codeScroll: { paddingTop: 2, paddingHorizontal: 16, paddingBottom: 16 },
    codeText: { fontFamily: MONO, fontSize: 12, lineHeight: 19, color: quiet ? c.fgMuted : c.fg },

    tableCode: { fontFamily: MONO, fontSize: tableSize - 1.5, color: quiet ? c.fgMuted : c.fg, backgroundColor: c.inlineCode },
    table: {
      minColumn: quiet ? 64 : 100,
      maxColumn: 240,
      // Geist's digits and capitals run near 0.62 em; CJK sets on the full em.
      charWidth: tableSize * 0.6,
      wideWidth: tableSize * 1.04,
      monoWidth: (tableSize - 1.5) * 0.62,
      // Both paddings and a little slack, so a cell sized to its text never breaks its last character.
      padding: 2 * side + 6,
      side,
    },
    tableHead: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.fgGhost },
    tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderStrong },
    tableHeadCell: { fontFamily: SANS, fontWeight: "500", fontSize: tableSize, lineHeight: 20, color: fg, ...cell },
    tableCell: {
      fontFamily: SANS,
      fontSize: tableSize,
      lineHeight: 20,
      color: fg,
      fontVariant: ["tabular-nums"] as FontVariant[],
      ...cell,
    },
    cellFirst: { paddingLeft: 0 },
    cellLast: { paddingRight: 0 },
  } as const;
}

function createReplyStyles(c: Palette) {
  return createStyles(c, false);
}

function createThoughtStyles(c: Palette): Styles {
  return createStyles(c, true);
}
