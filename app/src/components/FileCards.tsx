import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { listSessionFiles } from "../api";
import { useFileDownload, type DownloadState } from "../fileDownload";
import { humanSize, progressLabel, replyFiles, writtenPaths, type FileRef } from "../files";
import { t } from "../i18n/index.ts";
import { shortPath } from "../rows";
import { age } from "../sessionGroups";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { Machine, SessionFile, ToolItem } from "../types";
import { Spinner } from "./brand";
import { CheckGlyph, FileGlyph } from "./icons";
import { Sheet, SheetScrollView } from "./ui";

/**
 * A chat's files on the computer (`files`): the daemon's list of what the
 * session wrote or named (null until fetched), the directory it resolved
 * them in, and where to download them from. Null on a daemon without `files`.
 * `own` is false in a subagent's transcript: the session did not write its
 * files itself, so only those the daemon lists are offered.
 */
export interface FileLinksValue {
  machine: Machine;
  sessionId: string;
  cwd: string;
  list: SessionFile[] | null;
  own: boolean;
}

export const FileLinksContext = createContext<FileLinksValue | null>(null);

/**
 * The session's file list, fetched when the chat opens on a daemon with
 * `files`, again after each turn (`turns` changes) and on `refresh`. The
 * directory is the daemon's (it may resolve links), else the session's.
 */
export function useSessionFiles(
  machine: Machine,
  sessionId: string,
  sessionCwd: string,
  supported: boolean,
  turns: number,
): { value: FileLinksValue | null; refresh: () => void; error: string | null; loading: boolean } {
  const [answer, setAnswer] = useState<{ cwd: string; files: SessionFile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asked, setAsked] = useState(0);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    setLoading(true);
    listSessionFiles(machineRef.current, sessionId)
      .then((next) => {
        if (cancelled) return;
        setAnswer(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asked, sessionId, supported, turns]);
  const refresh = useCallback(() => setAsked((value) => value + 1), []);
  const cwd = answer !== null && answer.cwd !== "" ? answer.cwd : sessionCwd;
  const list = answer?.files ?? null;
  const value = useMemo(() => (supported ? { machine, sessionId, cwd, list, own: true } : null), [cwd, list, machine, sessionId, supported]);
  return { value, refresh, error, loading };
}

/** The status line of a file: how far its download is, why it failed, or what a tap does. */
function statusOf(state: DownloadState, entry: SessionFile | undefined): { text: string; tone: "muted" | "err" | "ok" } {
  switch (state.phase) {
    case "downloading":
      return { text: t("files.downloading", { progress: progressLabel(state.received, state.total) }), tone: "muted" };
    case "failed":
      return { text: state.message, tone: "err" };
    case "done":
      return { text: t("files.downloaded"), tone: "ok" };
    default:
      if (entry?.exists === false) return { text: t("files.gone"), tone: "muted" };
      return { text: entry?.size !== undefined ? humanSize(entry.size) : t("files.tapToDownload"), tone: "muted" };
  }
}

/** One file as a small card: tap to download it to the phone, then share it; tap a downloaded one to share it again. */
export function FileCard({ file, links }: { file: FileRef; links: FileLinksValue }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { state, open } = useFileDownload(links.machine, links.sessionId, file.path, file.name, file.entry?.size);
  const gone = file.entry?.exists === false && state.phase !== "done";
  const status = statusOf(state, file.entry);
  return (
    <Pressable
      onPress={open}
      disabled={gone}
      style={({ pressed }) => [styles.card, gone && styles.gone, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: gone, busy: state.phase === "downloading" }}
      accessibilityLabel={t("files.cardA11y", { name: file.name, status: status.text })}
    >
      <FileLead state={state} />
      <View style={styles.cardText}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {file.name}
        </Text>
        <Text style={[styles.status, { color: status.tone === "err" ? colors.err : status.tone === "ok" ? colors.ok : colors.fgFaint }]} numberOfLines={2}>
          {status.text}
        </Text>
      </View>
    </Pressable>
  );
}

function FileLead({ state }: { state: DownloadState }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={styles.lead}>
      {state.phase === "downloading" ? (
        <Spinner size={12} color={colors.accentB} />
      ) : state.phase === "done" ? (
        <CheckGlyph size={14} color={colors.ok} />
      ) : (
        <FileGlyph size={15} color={state.phase === "failed" ? colors.err : colors.fgMuted} />
      )}
    </View>
  );
}

/**
 * Under a finished turn: the files its calls wrote (always, marked when the
 * list says one is gone) and those its reply names that the daemon listed.
 */
export function FileStrip({ written, text }: { written: readonly string[]; text: string }): ReactNode {
  const links = useContext(FileLinksContext);
  const styles = useStyles(createStyles);
  const files = useMemo(() => {
    if (links === null) return [];
    const refs = replyFiles(written, text, links.cwd, links.list);
    return links.own ? refs : refs.filter((ref) => ref.entry !== undefined);
  }, [links, text, written]);
  if (links === null || files.length === 0) return null;
  return (
    <View style={styles.strip}>
      {files.map((file) => (
        <FileCard key={file.path} file={file} links={links} />
      ))}
    </View>
  );
}

/**
 * In a step's sheet: the files a write or edit call wrote. A subagent's step
 * (`own` false) offers only files the daemon lists, since the session did not
 * write them itself.
 */
export function ToolFiles({ tool, own }: { tool: ToolItem; own: boolean }): ReactNode {
  const links = useContext(FileLinksContext);
  const styles = useStyles(createStyles);
  const files = useMemo(() => {
    if (links === null) return [];
    const refs = replyFiles(writtenPaths(tool), "", links.cwd, links.list);
    return own && links.own ? refs : refs.filter((ref) => ref.entry !== undefined);
  }, [links, own, tool]);
  if (links === null || files.length === 0) return null;
  return (
    <View style={styles.sheetCards}>
      {files.map((file) => (
        <FileCard key={file.path} file={file} links={links} />
      ))}
    </View>
  );
}

/** The session's files from the chat header: everything the daemon lists, newest first. */
export function SessionFilesSheet({
  visible,
  links,
  loading,
  error,
  onClose,
}: {
  visible: boolean;
  links: FileLinksValue | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const { height } = useWindowDimensions();
  const list = links?.list ?? null;
  return (
    <Sheet visible={visible} title={t("files.title")} onClose={onClose} scroll={false}>
      <SheetScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.sheetList}>
        {links === null ? null : list === null || (list.length === 0 && loading) ? (
          <Text style={styles.note}>{error !== null ? t("files.loadFailed", { error }) : t("files.loading")}</Text>
        ) : list.length === 0 ? (
          <Text style={styles.note}>{t("files.empty")}</Text>
        ) : (
          list.map((entry) => <SessionFileRow key={entry.path} entry={entry} links={links} />)
        )}
        {list !== null && error !== null ? <Text style={styles.noteErr}>{t("files.loadFailed", { error })}</Text> : null}
      </SheetScrollView>
    </Sheet>
  );
}

function SessionFileRow({ entry, links }: { entry: SessionFile; links: FileLinksValue }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const { state, open } = useFileDownload(links.machine, links.sessionId, entry.path, entry.name, entry.size);
  const gone = !entry.exists && state.phase !== "done";
  const status = statusOf(state, entry);
  // The folder, relative to the session's; nothing for the session's own folder.
  const folder = entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";
  const where = folder === links.cwd.replace(/\/+$/, "") ? "" : shortPath(folder, links.cwd);
  const meta = [
    where,
    entry.size !== undefined && entry.exists ? humanSize(entry.size) : "",
    entry.mtime !== undefined && entry.exists ? age(entry.mtime) : "",
    t(`files.source.${entry.source}`),
  ].filter((part) => part !== "");
  return (
    <Pressable
      onPress={open}
      disabled={gone}
      style={({ pressed }) => [styles.row, gone && styles.gone, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: gone, busy: state.phase === "downloading" }}
      accessibilityLabel={t("files.cardA11y", { name: entry.name, status: status.text })}
    >
      <FileLead state={state} />
      <View style={styles.cardText}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
          {entry.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1} ellipsizeMode="head">
          {meta.join(" · ")}
        </Text>
        {state.phase !== "idle" || gone ? (
          <Text style={[styles.status, { color: status.tone === "err" ? colors.err : status.tone === "ok" ? colors.ok : colors.fgFaint }]} numberOfLines={2}>
            {status.text}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function createStyles(c: Palette) {
  const card = {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: c.well,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  } as const;
  return {
    strip: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
    sheetCards: { gap: 6 },
    card: { ...card, minHeight: 44, maxWidth: "100%" },
    row: { ...card, minHeight: 52, paddingVertical: 9 },
    gone: { opacity: 0.55 },
    pressed: { opacity: 0.7 },
    lead: { width: 16, alignItems: "center" },
    cardText: { flexShrink: 1, minWidth: 0 },
    name: { fontFamily: SANS, fontSize: 13.5, lineHeight: 18, fontWeight: "600", color: c.fg },
    status: { fontFamily: MONO, fontSize: 11, lineHeight: 15 },
    meta: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgMuted },
    sheetList: { gap: 6, paddingBottom: 8 },
    note: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgMuted, paddingVertical: 8 },
    noteErr: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.err, paddingVertical: 4 },
  } as const;
}
