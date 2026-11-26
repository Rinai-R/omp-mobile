import { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { parse, SvgAst, type JsxAST, type XmlAST } from "react-native-svg";
import {
  remoteFormImage,
  sanitizeSvgTree,
  svgDataMarkup,
  svgTreeMarkup,
} from "../approvalMedia";
import { type FormSpan, type FormBlock } from "../../vendor/omp-form/parse.ts";
import { imageUri, relayImageUri } from "../media";
import { useColors, MONO } from "../theme";
import { t } from "../i18n/index.ts";
import type { ApprovalRequest, Machine } from "../types";
export function ApprovalSpans({ spans }: { spans: FormSpan[] }) {
  const c = useColors();
  return (
    <Text style={{ color: c.fg, fontSize: 15, lineHeight: 22 }}>
      {spans.map((s, i) => (
        <Text
          key={i}
          style={
            s.style === "strong"
              ? { fontWeight: "700" }
              : s.style === "em"
                ? { fontStyle: "italic" }
                : s.style === "code"
                  ? { fontFamily: MONO }
                  : undefined
          }
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}
function ResourceLinks({ links }: { links: string[] }) {
  const c = useColors();
  return (
    <>
      {links.map((url) => (
        <Text key={url} style={{ color: c.fgMuted }}>
          {t("approval.remoteImage")}
          <Text
            accessibilityRole="link"
            style={{ color: c.tint, textDecorationLine: "underline" }}
            onPress={() => {
              void Linking.openURL(url).catch(() => undefined);
            }}
          >{`\n${t("common.open")} · ${url}`}</Text>
        </Text>
      ))}
    </>
  );
}

function safeSvg(markup: string): { ast: JsxAST | null; links: string[] } {
  const links = new Set<string>();
  const clean = (tree: XmlAST, depth: number): XmlAST => {
    const result = sanitizeSvgTree(tree, (uri) => {
      if (depth >= 4) return;
      const nested = svgDataMarkup(uri);
      if (nested === undefined) return;
      let serialized: string | undefined;
      parse(nested, (nestedTree) => {
        clean(nestedTree, depth + 1);
        serialized = svgTreeMarkup(nestedTree);
        return nestedTree;
      });
      return serialized
        ? `data:image/svg+xml,${encodeURIComponent(serialized)}`
        : undefined;
    });
    for (const link of result.links) links.add(link);
    return tree;
  };
  return { ast: parse(markup, (tree) => clean(tree, 0)), links: [...links] };
}
function SafeSvg({
  markup,
  onFailure,
  height = 220,
}: {
  markup: string;
  onFailure: () => void;
  height?: number;
}) {
  const result = useMemo(() => {
    try {
      return safeSvg(markup);
    } catch {
      return undefined;
    }
  }, [markup]);
  useEffect(() => {
    if (!result) onFailure();
  }, [result, onFailure]);
  return result ? (
    <>
      <SvgAst ast={result.ast} override={{ width: "100%", height }} />
      <ResourceLinks links={result.links} />
    </>
  ) : null;
}
function SvgImage({
  uri,
  onReady,
  onFailure,
  src,
  height,
}: {
  uri: string;
  height: number;
  src: string;
  onReady: (src: string) => void;
  onFailure: () => void;
}) {
  const [markup, setMarkup] = useState<string>();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const xml = svgDataMarkup(uri) ?? (await (await fetch(uri)).text());
        const result = safeSvg(xml);
        if (!result.ast) throw new Error("Invalid SVG");
        if (live) {
          setMarkup(xml);
          onReady(src);
        }
      } catch {
        if (live) onFailure();
      }
    })();
    return () => {
      live = false;
    };
  }, [uri]);
  return markup ? (
    <SafeSvg markup={markup} onFailure={onFailure} height={height} />
  ) : null;
}
function FormImage({
  src,
  alt,
  request,
  machine,
  onFailure,
  onReady,
}: {
  src: string;
  alt: string;
  request: ApprovalRequest;
  machine: Machine;
  onFailure: () => void;
  onReady: (src: string) => void;
}) {
  const remote = remoteFormImage(src);
  const part =
    (request.images && Object.hasOwn(request.images, src)
      ? request.images[src]
      : undefined) ??
    (/^blob:sha256:[0-9a-f]{64}$/.test(src)
      ? { type: "image" as const, data: src, mimeType: undefined }
      : undefined);
  const [uri, setUri] = useState(
    part ? imageUri(machine, part) : /^data:/i.test(src) ? src : undefined,
  );
  const [failed, setFailed] = useState(false);
  const [large, setLarge] = useState(false);
  const c = useColors();
  useEffect(() => {
    let live = true;
    if (remote) {
      onReady(src);
      return;
    }
    if (part && uri === undefined) {
      const pending = relayImageUri(machine, part);
      if (pending)
        void pending.then((v) => {
          if (live) {
            setUri(v);
            if (!v) {
              setFailed(true);
              onFailure();
            }
          }
        });
    } else if (!uri) {
      setFailed(true);
      onFailure();
    }
    return () => {
      live = false;
    };
  }, [src]);
  const failure = () => {
    setFailed(true);
    onFailure();
  };
  if (remote)
    return (
      <View style={{ gap: 6 }}>
        {alt ? <Text style={{ color: c.fgMuted }}>{alt}</Text> : null}
        <ResourceLinks links={[remote]} />
      </View>
    );
  return (
    <View style={{ gap: 6 }}>
      {alt ? <Text style={{ color: c.fgMuted }}>{alt}</Text> : null}
      {failed ? (
        <Text style={{ color: c.sysRed }}>{t("approval.imageFailed")}</Text>
      ) : uri ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={alt || src}
          onPress={() => setLarge((v) => !v)}
        >
          {part?.mimeType === "image/svg+xml" ||
          /^data:image\/svg\+xml/i.test(uri) ? (
            <SvgImage
              uri={uri}
              height={large ? 440 : 220}
              src={src}
              onReady={onReady}
              onFailure={failure}
            />
          ) : (
            <Image
              source={{ uri }}
              resizeMode="contain"
              style={{ width: "100%", height: large ? 440 : 220 }}
              onError={failure}
              onLoad={() => onReady(src)}
            />
          )}
        </Pressable>
      ) : (
        <Text style={{ color: c.fgMuted }}>…</Text>
      )}
    </View>
  );
}
export function ApprovalBlock({
  block,
  request,
  machine,
  onFailure,
  onReady,
}: {
  block: Exclude<FormBlock, { kind: "field" }>;
  request: ApprovalRequest;
  machine: Machine;
  onFailure: () => void;
  onReady: (src: string) => void;
}) {
  const c = useColors();
  switch (block.kind) {
    case "text":
      return <ApprovalSpans spans={block.spans} />;
    case "pre":
      return (
        <ScrollView horizontal>
          <Text
            selectable
            style={{
              fontFamily: MONO,
              color: c.fg,
              backgroundColor: c.inset,
              padding: 10,
            }}
          >
            {block.text}
          </Text>
        </ScrollView>
      );
    case "list":
      return (
        <View style={{ gap: 5 }}>
          {block.items.map((spans, i) => (
            <Text key={i} style={{ color: c.fg }}>
              {block.ordered ? `${i + 1}. ` : "• "}
              <ApprovalSpans spans={spans} />
            </Text>
          ))}
        </View>
      );
    case "table":
      return (
        <ScrollView horizontal>
          <View>
            {block.rows.map((row, i) => (
              <View key={i} style={{ flexDirection: "row" }}>
                {row.map((spans, j) => (
                  <View
                    key={j}
                    style={{
                      width: 160,
                      padding: 8,
                      borderWidth: 0.5,
                      borderColor: c.separator,
                    }}
                  >
                    <ApprovalSpans spans={spans} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case "image":
      return (
        <FormImage
          {...block}
          request={request}
          machine={machine}
          onFailure={onFailure}
          onReady={onReady}
        />
      );
    case "svg":
      return (
        <View>
          {block.alt ? (
            <Text style={{ color: c.fgMuted }}>{block.alt}</Text>
          ) : null}
          <SafeSvg markup={block.markup} onFailure={onFailure} />
        </View>
      );
  }
}
