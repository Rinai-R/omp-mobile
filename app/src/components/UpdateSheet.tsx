import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Reanimated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getLanguage, t } from "../i18n/index.ts";
import { notesFor, RELEASES_PAGE, type ReleaseEntry, type UpdateOffer } from "../releases";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { ApkUpdateState, UpdateStatus } from "../useApkUpdate";
import { BrandMark, GradientFill, Spinner } from "./brand";
import { CheckGlyph, WarningGlyph } from "./icons";
import { Markdown } from "./Markdown";
import { ConfirmSheet, Button, PressableScale, SheetGrab, SheetHost, SheetScrollView, SheetSurface, sheetSurface, useSheet } from "./ui";

/**
 * The update sheet: what changed in every release the phone skipped, newest
 * first, each in the reader's language, then one action for the newest APK.
 * The action stays put under the notes; a download turns it into its own
 * progress bar, so the sheet never changes shape while it runs.
 */
export function UpdateSheet({ sheet, installed }: { sheet: ApkUpdateState["sheet"]; installed: string }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const controller = useSheet(sheet.visible, sheet.onClose);
  // While it slides out, the sheet keeps what it showed.
  const shown = useRef(sheet.status);
  if (sheet.visible) shown.current = sheet.status;
  const status = shown.current;
  const offer = "offer" in status ? status.offer : null;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const openReleases = useCallback(() => void Linking.openURL(RELEASES_PAGE).catch(() => undefined), []);

  return (
    <>
      <SheetHost sheet={controller} backdropLabel={t("common.close")}>
        <SheetSurface style={[styles.surface, { paddingBottom: 14 + insets.bottom, maxHeight: height - insets.top - 24 }]} skirt={colors.overlay}>
          <SheetGrab style={styles.grabArea}>
            <View style={styles.grab} />
            <Header status={status} installed={installed} />
          </SheetGrab>
          {offer !== null ? (
            <SheetScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
              {offer.versions.map((entry, index) => (
                <Entry key={entry.version} entry={entry} latest={index === 0} last={index === offer.versions.length - 1} />
              ))}
              <Text style={styles.allReleases} onPress={openReleases} accessibilityRole="link">
                {t("settings.updates.allReleases")}
              </Text>
            </SheetScrollView>
          ) : null}
          <Footer
            status={status}
            onPrimary={status.kind === "paused" ? sheet.onResume ?? sheet.onPrimary : sheet.onPrimary}
            onClose={sheet.onClose}
            onReleases={openReleases}
            onAskPause={() => {
              const current = status;
              if (current.kind === "downloading") sheet.onPause?.();
            }}
            onAskCancel={() => setConfirmCancel(true)}
          />
        </SheetSurface>
      </SheetHost>
      <ConfirmSheet
        visible={confirmCancel}
        title={t("settings.updates.cancelTitle")}
        body={t("settings.updates.cancelBody")}
        action={t("settings.updates.cancelAction")}
        danger
        onConfirm={() => { setConfirmCancel(false); sheet.onCancel?.(); }}
        onClose={() => setConfirmCancel(false)}
      />
    </>
  );
}

/** The tile, an eyebrow, the version it is about, and one quiet line under it. */
function Header({ status, installed }: { status: UpdateStatus; installed: string }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  let eyebrow: string;
  let title: string;
  let detail: string;
  let tone: "brand" | "ok" | "warn" = "brand";
  if ("offer" in status) {
    const newest = status.offer.versions[0]?.version ?? status.offer.target.version;
    const count = status.offer.versions.length;
    eyebrow = t("settings.updates.eyebrow");
    title = newest;
    detail = count > 1 ? t("settings.updates.spanMany", { from: installed, to: newest, count }) : t("settings.updates.span", { from: installed, to: newest });
  } else if (status.kind === "current") {
    eyebrow = t("settings.about.app");
    title = t("settings.updates.current");
    detail = t("settings.updates.currentDetail", { version: installed });
    tone = "ok";
  } else if (status.kind === "checkFailed") {
    eyebrow = t("settings.about.app");
    title = t("settings.updates.failedTitle");
    detail = t("settings.updates.failed");
    tone = "warn";
  } else {
    eyebrow = t("settings.about.app");
    title = t("settings.updates.checking");
    detail = t("settings.updates.installed", { version: installed });
  }
  return (
    <View style={styles.header}>
      <View style={styles.tile}>
        {tone === "brand" ? <GradientFill colors={[colors.accentA, colors.accentV, colors.accentB]} radius={16} /> : null}
        {tone === "brand" ? (
          status.kind === "checking" ? <Spinner size={18} color="#ffffff" /> : <BrandMark size={26} color="#ffffff" />
        ) : tone === "ok" ? (
          <CheckGlyph size={24} color={colors.ok} />
        ) : (
          <WarningGlyph size={22} color={colors.warn} />
        )}
      </View>
      <View style={styles.headerText}>
        <Text style={tone === "brand" ? styles.eyebrow : styles.eyebrowQuiet}>{eyebrow}</Text>
        <Text style={"offer" in status ? styles.version : styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

/** One release on the timeline: a node on the rail, its version and date, then its notes. */
function Entry({ entry, latest, last }: { entry: ReleaseEntry; latest: boolean; last: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const notes = notesFor(entry.notes, getLanguage());
  return (
    <View style={styles.entry}>
      <View style={styles.rail}>
        <View style={latest ? styles.halo : styles.haloNone}>
          <View style={latest ? styles.dotLatest : styles.dot} />
        </View>
        {last ? null : <View style={styles.line} />}
      </View>
      <View style={[styles.entryBody, last && styles.entryBodyLast]}>
        <View style={styles.entryHead}>
          <Text style={styles.entryVersion}>v{entry.version}</Text>
          {latest ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{t("settings.updates.latest")}</Text>
            </View>
          ) : null}
          <View style={styles.flex} />
          {entry.publishedAt > 0 ? <Text style={styles.date}>{dateOf(entry.publishedAt)}</Text> : null}
        </View>
        {notes === "" ? <Text style={styles.noNotes}>{t("settings.updates.noNotes")}</Text> : <Markdown text={notes} />}
      </View>
    </View>
  );
}

/** A status line when there is something to say, the primary action, and the way out. */
function Footer({
  status,
  onPrimary,
  onClose,
  onReleases,
  onAskPause,
  onAskCancel,
}: {
  status: UpdateStatus;
  onPrimary: () => void;
  onClose: () => void;
  onReleases: () => void;
  onAskPause: () => void;
  onAskCancel: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const note = noteOf(status);
  return (
    <View style={styles.footer}>
      {note !== null ? (
        <View style={styles.note}>
          {note.tone === "ok" ? <CheckGlyph size={14} color={colors.ok} /> : <WarningGlyph size={14} color={note.tone === "warn" ? colors.warn : colors.fgFaint} />}
          <Text style={note.tone === "ok" ? styles.noteOk : note.tone === "warn" ? styles.noteWarn : styles.noteText}>{note.text}</Text>
        </View>
      ) : null}
      {status.kind === "downloading" || status.kind === "paused" ? (
        <Progress
          percent={status.percent}
          paused={status.kind === "paused"}
          onPress={status.kind === "downloading" ? onAskPause : onPrimary}
        />
      ) : status.kind === "checking" ? null : (
        <Button label={primaryLabel(status)} onPress={status.kind === "current" ? onClose : onPrimary} />
      )}
      {"offer" in status ? (
        <Button
          label={status.kind === "downloading" || status.kind === "paused" ? t("settings.updates.cancelDownload") : t("settings.updates.later")}
          kind="plain"
          onPress={status.kind === "downloading" || status.kind === "paused" ? onAskCancel : onClose}
        />
      ) : status.kind === "checking" ? null : (
        <Button label={t("settings.updates.releases")} kind="plain" onPress={onReleases} />
      )}
    </View>
  );
}

/**
 * The primary button's place while the APK downloads: a track that fills, its
 * label drawn twice and clipped to the fill, so the text inverts exactly where
 * the fill passes under it instead of fading through a grey nobody can read.
 */
function Progress({ percent, paused, onPress }: { percent: number | null; paused: boolean; onPress: () => void }): ReactNode {
  const styles = useStyles(createStyles);
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const fraction = useSharedValue(0);
  useEffect(() => {
    const next = Math.max(0.02, (percent ?? 0) / 100);
    fraction.set(reduced ? next : withTiming(next, { duration: 240, easing: Easing.out(Easing.cubic) }));
  }, [fraction, percent, reduced]);
  const fill = useAnimatedStyle(() => ({ width: fraction.get() * width }));
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const label = percent === null
    ? t(paused ? "settings.updates.pausedUnknown" : "settings.updates.downloadingUnknown")
    : t(paused ? "settings.updates.pausedLabel" : "settings.updates.downloading", { percent });
  const action = t(paused ? "settings.updates.resumeDownload" : "settings.updates.pauseDownload");
  const shown = `${label} · ${action}`;
  return (
    <PressableScale
      style={styles.track}
      accessibilityRole="button"
      accessibilityLabel={shown}
      accessibilityValue={{ min: 0, max: 100, now: percent ?? 0 }}
      onPress={onPress}
    >
      <View style={styles.trackInner} onLayout={onLayout}>
        <View style={styles.trackLabelBox}>
          <Text style={styles.trackLabel}>{shown}</Text>
        </View>
        <Reanimated.View style={[styles.fill, fill]}>
          <View style={[styles.trackLabelBox, { width }]}>
            <Text style={styles.fillLabel}>{shown}</Text>
          </View>
        </Reanimated.View>
      </View>
    </PressableScale>
  );
}

function primaryLabel(status: UpdateStatus): string {
  switch (status.kind) {
    case "offer":
      return status.offer.target.bytes > 0 ? t("settings.updates.downloadSize", { size: sizeOf(status.offer.target.bytes) }) : t("settings.updates.download");
    case "downloadFailed":
      return t("common.tryAgain");
    case "ready":
    case "installFailed":
      return t("settings.updates.install");
    case "permission":
      return t("settings.updates.openSettings");
    case "checkFailed":
      return t("common.tryAgain");
    case "paused":
      return t("settings.updates.resumeDownload");
    case "current":
      return t("settings.updates.done");
    case "checking":
    case "downloading":
      return "";
  }
}

function noteOf(status: UpdateStatus): { text: string; tone: "ok" | "warn" | "quiet" } | null {
  switch (status.kind) {
    case "ready":
      return { text: t("settings.updates.ready"), tone: "ok" };
    case "permission":
      return { text: t("settings.updates.permission"), tone: "quiet" };
    case "downloadFailed":
      return { text: t("settings.updates.downloadFailed"), tone: "warn" };
    case "installFailed":
      return { text: t("settings.updates.installFailed"), tone: "warn" };
    default:
      return null;
  }
}

/** Megabytes as Android shows sizes (decimal), whole above ten. */
function sizeOf(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** "Nov 24", "11月24日": the app's own short date. */
function dateOf(time: number): string {
  const date = new Date(time);
  const months = t("age.months").split(" ");
  return t("age.date", { month: months[date.getMonth()] ?? String(date.getMonth() + 1), day: date.getDate() });
}

function createStyles(c: Palette) {
  const label = { fontFamily: MONO, fontSize: 10.5, lineHeight: 14, fontWeight: "500", letterSpacing: 1.6, textTransform: "uppercase" } as const;
  const noteBase = { flex: 1, fontFamily: SANS, fontSize: 13, lineHeight: 19 } as const;
  return StyleSheet.create({
    surface: { ...sheetSurface(c), paddingHorizontal: 20 },
    grabArea: { gap: 18, paddingBottom: 4 },
    grab: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: c.borderStrong },
    header: { flexDirection: "row", alignItems: "center", gap: 16, paddingBottom: 6 },
    tile: {
      width: 56,
      height: 56,
      borderRadius: 16,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.well,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    headerText: { flex: 1, minWidth: 0 },
    eyebrow: { ...label, color: c.accentB },
    eyebrowQuiet: { ...label, color: c.fgFaint },
    version: { fontFamily: SANS, fontSize: 30, lineHeight: 36, fontWeight: "600", letterSpacing: -0.9, color: c.fg, fontVariant: ["tabular-nums"] },
    title: { fontFamily: SANS, fontSize: 20, lineHeight: 26, fontWeight: "600", letterSpacing: -0.4, color: c.fg, marginTop: 2 },
    detail: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgFaint, marginTop: 2 },

    scroll: { flexShrink: 1, marginTop: 10 },
    scrollBody: { paddingTop: 12, paddingBottom: 6 },
    entry: { flexDirection: "row", gap: 12 },
    rail: { width: 16, alignItems: "center" },
    // The node sits on the version line's centre (16/21 type: 10.5 down).
    halo: { width: 16, height: 16, borderRadius: 8, marginTop: 2.5, alignItems: "center", justifyContent: "center", backgroundColor: `${c.accentB}2e` },
    haloNone: { width: 16, height: 16, marginTop: 2.5, alignItems: "center", justifyContent: "center" },
    dotLatest: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accentB },
    dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: c.borderStrong, backgroundColor: c.overlay },
    line: { flex: 1, width: 1.5, borderRadius: 1, marginTop: 4, marginBottom: -2.5, backgroundColor: c.border },
    entryBody: { flex: 1, minWidth: 0, paddingBottom: 22 },
    entryBodyLast: { paddingBottom: 10 },
    entryHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    entryVersion: { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.2, color: c.fg },
    pill: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1.5, backgroundColor: `${c.accentB}24` },
    pillText: { ...label, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.2, color: c.accentB },
    flex: { flex: 1 },
    date: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgGhost },
    noNotes: { fontFamily: SANS, fontSize: 14, lineHeight: 21, color: c.fgFaint },
    allReleases: { fontFamily: SANS, fontSize: 13, lineHeight: 19, color: c.fgFaint, paddingLeft: 28, paddingTop: 4, paddingBottom: 6 },

    footer: { gap: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, marginTop: 4 },
    trackInner: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" },
    note: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 2, paddingBottom: 4 },
    noteText: { ...noteBase, color: c.fgMuted },
    noteOk: { ...noteBase, color: c.ok },
    noteWarn: { ...noteBase, color: c.warn },

    track: { height: 48, borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.well, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    fill: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden", backgroundColor: c.fg },
    trackLabelBox: { position: "absolute", left: 0, top: 0, height: 48, right: 0, alignItems: "center", justifyContent: "center" },
    trackLabel: { fontFamily: SANS, fontSize: 15, fontWeight: "600", color: c.fg, fontVariant: ["tabular-nums"] },
    fillLabel: { fontFamily: SANS, fontSize: 15, fontWeight: "600", color: c.bg, fontVariant: ["tabular-nums"] },
  });
}
