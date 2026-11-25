import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { SvgUri, SvgXml } from "react-native-svg";
import {
  type FormSpan,
  type FormBlock,
} from "../../vendor/omp-form/parse.ts";
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
  const part =
    (request.images && Object.hasOwn(request.images, src)
      ? request.images[src]
      : undefined) ??
    (/^blob:sha256:[0-9a-f]{64}$/.test(src)
      ? { type: "image" as const, data: src, mimeType: undefined }
      : undefined);
  const [uri, setUri] = useState(
    part
      ? imageUri(machine, part)
      : /^(https?:|data:)/i.test(src)
        ? src
        : undefined,
  );
  const [failed, setFailed] = useState(false);
  const [large, setLarge] = useState(false);
  const c = useColors();
  useEffect(() => {
    let live = true;
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
            <SvgUri
              uri={uri}
              width="100%"
              height={large ? 440 : 220}
              onError={failure}
              onLoad={() => onReady(src)}
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
          <SvgXml
            xml={block.markup}
            width="100%"
            height={220}
            onError={onFailure}
          />
        </View>
      );
  }
}
