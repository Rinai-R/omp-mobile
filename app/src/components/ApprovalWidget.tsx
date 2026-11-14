import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../i18n/index.ts";
import { haptic } from "../haptics";
import { approvalText, TOOL_APPROVAL_PREFIX } from "../ompText";
import { age } from "../sessionGroups";
import { MONO, SANS, useColors, useStyles, type Palette } from "../theme";
import type { SessionSummary } from "../types";
import { BrandMark, GradientFill, Spinner } from "./brand";


type Request = NonNullable<SessionSummary["request"]>;
type Answer = { value?: string; confirmed?: boolean };

/**
 * The one-tap "allow" a waiting question offers from the home: approve-this-call
 * for a tool approval, yes for a confirm. Questions that need typing or a
 * choice among several answers return undefined and are answered in the chat.
 */
export function quickAnswer(request: Request): Answer | undefined {
  if (request.method === "confirm") return { confirmed: true };
  if (request.method !== "select" || !request.title.startsWith(TOOL_APPROVAL_PREFIX)) return undefined;
  const options = request.options ?? [];
  const once = options.find((option) => option === "Approve Once" || option === "Approve" || option === "Approve File");
  return once === undefined ? undefined : { value: once };
}

/** What the card says the question is about: the tool and its first detail (`bash · ls -la`), or the question itself. */
function subjectOf(request: Request): string {
  const text = approvalText(request.title, request.message);
  const first = text.details[0]?.value.replace(/\s+/g, " ");
  if (text.tool === undefined) return [text.heading, first].filter(Boolean).join(" · ");
  return first === undefined ? text.tool : `${text.tool} · ${first}`;
}

/**
 * A session waiting for the user, as an iOS-style widget on the home: what
 * asks, the session, the command, and View / Allow. Allow answers in place.
 */
export function ApprovalWidget({
  session,
  onView,
  onAnswer,
}: {
  session: SessionSummary & { request: Request };
  onView: () => void;
  onAnswer: (answer: Answer) => Promise<void>;
}): ReactNode {
  const styles = useStyles(createStyles);
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = quickAnswer(session.request);
  const tool = session.request.title.startsWith(TOOL_APPROVAL_PREFIX);
  return (
    <View style={styles.widget}>
      <GradientFill colors={[c.widgetA, c.widgetB, c.widgetC]} radius={24} />
      <View style={styles.head}>
        <View style={styles.appIcon}>
          <BrandMark size={13} />
        </View>
        <Text style={styles.kind} numberOfLines={1}>
          {tool ? t("home.widget.title") : t("home.widget.question")}
        </Text>
        <Text style={styles.when}>{age(session.updatedAt)}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {session.title}
      </Text>
      <Text style={styles.subject} numberOfLines={2}>
        {subjectOf(session.request)}
      </Text>
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onView}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("home.widget.view")}
        >
          <Text style={styles.actionText}>{t("home.widget.view")}</Text>
        </Pressable>
        {answer !== undefined ? (
          <Pressable
            disabled={busy}
            onPress={() => {
              haptic.press();
              setBusy(true);
              setError(null);
              onAnswer(answer)
                .catch((cause: unknown) => setError(t("home.widget.failed", { error: cause instanceof Error ? cause.message : String(cause) })))
                .finally(() => setBusy(false));
            }}
            style={({ pressed }) => [styles.allow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t("home.widget.allow")}
          >
            {busy ? <Spinner size={14} color={c.fabFg} /> : <Text style={styles.allowText}>{t("home.widget.allow")}</Text>}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(c: Palette) {
  const action = { flex: 1, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" } as const;
  const strong = c.dark ? "#ffffff" : c.fg;
  return {
    widget: {
      marginHorizontal: 16,
      marginBottom: 14,
      padding: 16,
      borderRadius: 24,
      overflow: "hidden",
      borderWidth: 0.5,
      borderColor: c.dark ? "#ffffff2a" : "#0000000f",
    },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    appIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.dark ? "#000000" : "#ffffff" },
    kind: { flex: 1, fontFamily: SANS, fontSize: 13, lineHeight: 18, fontWeight: "600", color: c.sysYellow },
    when: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.dark ? "#c7c7cc" : c.fgFaint },
    title: { fontFamily: SANS, fontSize: 18, lineHeight: 23, fontWeight: "600", letterSpacing: -0.4, color: strong, marginTop: 10, marginBottom: 4 },
    subject: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, color: c.dark ? "#c7c7cc" : c.fgMuted },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.sysRed, marginTop: 8 },
    actions: { flexDirection: "row", gap: 10, marginTop: 14 },
    action: { ...action, backgroundColor: c.widgetButton },
    actionText: { fontFamily: SANS, fontSize: 15, lineHeight: 20, fontWeight: "600", color: strong },
    allow: { ...action, backgroundColor: c.fab },
    allowText: { fontFamily: SANS, fontSize: 15, lineHeight: 20, fontWeight: "600", color: c.fabFg },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  } as const;
}
