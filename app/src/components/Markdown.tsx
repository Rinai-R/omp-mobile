import { memo, useMemo, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type FontVariant } from "react-native";
import { parseBlocks, parseInline, type Block, type Inline } from "../markdown";
import { SANS, MONO, radius, useStyles, type Palette } from "../theme";

/** Renders the blocks `parseBlocks` produces for assistant text. */

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

/** A pipe table: header row, hairline grid, horizontal scroll for wide columns. */
function TableBlock({ block, styles }: { block: Extract<Block, { kind: "table" }>; styles: Styles }): ReactNode {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHead]}>
          {block.header.map((cell, index) => (
            <Text
              key={index}
              style={[styles.tableCell, styles.tableHeadCell, { textAlign: block.aligns[index] ?? "left" }]}
              selectable
            >
              {renderInline(parseInline(cell), styles)}
            </Text>
          ))}
        </View>
        {block.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, index) => (
              <Text key={index} style={[styles.tableCell, { textAlign: block.aligns[index] ?? "left" }]} selectable>
                {renderInline(parseInline(cell), styles)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
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
          case "table":
            return <TableBlock key={index} block={block} styles={styles} />;
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
  const body = { fontFamily: SANS, fontSize: 15, lineHeight: 23, color: c.fg } as const;
  const heading = { fontWeight: "600", letterSpacing: -0.2, color: c.fg, marginTop: 6 } as const;
  return {
    root: { gap: 8 },
    paragraph: body,
    h1: { ...heading, fontSize: 18, lineHeight: 24 },
    h2: { ...heading, fontSize: 16, lineHeight: 22 },
    h3: { ...heading, fontSize: 15, lineHeight: 21, marginTop: 4 },
    bold: { fontWeight: "600" },
    italic: { fontStyle: "italic" },
    link: { color: c.accent },
    inlineCode: {
      fontFamily: MONO,
      fontSize: 13,
      color: c.fg,
      backgroundColor: c.selected,
    },
    list: { gap: 4 },
    item: { flexDirection: "row", gap: 8 },
    bullet: { ...body, width: 14, color: c.fgFaint, textAlign: "center" },
    number: {
      ...body,
      minWidth: 18,
      fontFamily: MONO,
      fontSize: 13,
      color: c.fgFaint,
      fontVariant: ["tabular-nums"] as FontVariant[],
    },
    itemText: { ...body, flex: 1 },
    quote: { borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: 12, paddingVertical: 2 },
    quoteText: { ...body, color: c.fgMuted },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: 8 },
    codeBox: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.inset,
      overflow: "hidden",
    },
    codeLang: {
      fontFamily: MONO,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.fgFaint,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    codeScroll: { paddingHorizontal: 12, paddingVertical: 10 },
    codeText: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: c.fg },
    tableScroll: { marginVertical: 2 },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      overflow: "hidden",
    },
    tableRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    tableHead: { backgroundColor: c.raised, borderTopWidth: 0 },
    tableCell: { fontFamily: SANS,
      width: 150,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
      lineHeight: 19,
      color: c.fg,
    },
    tableHeadCell: { fontFamily: MONO, fontSize: 11, lineHeight: 16, color: c.fgMuted },
  } as const;
}
