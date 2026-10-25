import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Attention from "../../modules/omp-attention/src";
import { HttpError, SessionSocket, daemonFeatures, knownFeatures, openSession, takeOverSession, type OpenFailure } from "../api";
import { attachHead, heldOfWindow, mergeWindow, type Held, type TranscriptWindow } from "../cache";
import { t } from "../i18n/index.ts";
import { MAX_ATTACHMENTS, pickPhotos, type Attachment } from "../attachments";
import { ApprovalSheet } from "../components/ApprovalSheet";
import { BrandMark, GradientDot, LiveDot, PulseDot, Spinner } from "../components/brand";
import { Composer } from "../components/Composer";
import { ArrowDownGlyph, BackGlyph, ChevronDownGlyph, WarningGlyph } from "../components/icons";
import { ModelSheet } from "../components/ModelSheet";
import { TodoPanel } from "../components/TodoPanel";
import { ToolSheet } from "../components/ToolSheet";
import { TranscriptRow } from "../components/Transcript";
import { Banner, ConfirmSheet, IconButton } from "../components/ui";
import { applyEvent, snapshotItems } from "../messages";
import { displayName } from "../machines";
import { layoutRows, type Row, type Step } from "../rows";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import { canTakeOver, confirmBody, heldLine } from "../takeover.ts";
import { todoPhases } from "../todos";
import { refreshTranscript } from "../sync";
import { loadCached, loadTail, markViewed, saveCached } from "../transcripts";
import type {
  AgentMessage,
  ApprovalRequest,
  ChatItem as Item,
  Machine,
  ModelOption,
  ServerMessage,
  SessionState,
  SessionSummary,
} from "../types";

interface Props {
  machine: Machine;
  session: SessionSummary;
  onBack: () => void;
  /** Open the session switcher (the title). */
  onSwitch: () => void;
}

/** Connection attempts without an open after which the screen asks the daemon over HTTP why. */
const ASK_AFTER = 3;
/** How far from the newest message (px) still counts as "at the bottom". */
const NEAR_BOTTOM = 160;

/** What the failure card says for the status the daemon answered with; the status line under it carries the detail. */
function failureText(failure: OpenFailure): { title: string; body?: string } {
  switch (failure.status) {
    case 404:
      return { title: t("chat.failure.gone.title") };
    case 409:
      return { title: t("chat.failure.terminal.title"), body: t("chat.failure.terminal.body") };
    case 410:
      return { title: t("chat.failure.fileGone.title") };
    default:
      return { title: t("chat.failure.other.title") };
  }
}

export function ChatScreen({ machine, session: initialSession, onBack, onSwitch }: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const listRef = useRef<FlatList<Row>>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  const [session, setSession] = useState(initialSession);
  const [state, setState] = useState<SessionState | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [connected, setConnected] = useState(false);
  const [failure, setFailure] = useState<OpenFailure | null>(null);
  const failedRef = useRef(false);
  failedRef.current = failure !== null;
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [levels, setLevels] = useState<string[] | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  /** A takeover of a session held on the computer is in flight, or what it failed with. */
  const [taking, setTaking] = useState(false);
  /** The socket is up but the daemon is still opening the session (an omp starts, the snapshot follows). */
  const [opening, setOpening] = useState(false);
  /** A chat just opened: no status word for the first second, so a 3 ms socket does not flash "connecting". */
  const [settled, setSettled] = useState(false);
  const [takeError, setTakeError] = useState<string | null>(null);
  const [confirmTake, setConfirmTake] = useState(false);
  /** The daemon's snapshot has replaced whatever the saved transcript showed. */
  const live = useRef(false);
  /**
   * The transcript the phone holds, as the daemon sent it: the cached copy's tail first
   * (offset > 0), the whole copy once it is read, extended by snapshots. What `since`/`last` describe.
   */
  const windowRef = useRef<TranscriptWindow>({ offset: 0, messages: [] });
  /** The whole cached copy once read; `null` when it could not be (missing, damaged, not matching the tail). */
  const headRef = useRef<AgentMessage[] | null | undefined>(undefined);
  /** What the current socket was opened with, and the window that described: a snapshot is merged against exactly these. */
  const sentRef = useRef<{ held: Held | undefined; window: TranscriptWindow }>({ held: undefined, window: { offset: 0, messages: [] } });
  /** What a snapshot brought that is not saved yet: saved once the whole transcript is known. */
  const unsavedRef = useRef<{ updatedAt: number; session: SessionSummary; state: SessionState | null } | null>(null);
  /** Older rows are joining the list (the whole copy under its tail): they appear without an entrance. */
  const quietRef = useRef(false);
  /** A snapshot did not fit the copy: the next connect asks for the whole transcript. */
  const wholeRef = useRef(false);
  /** The copy as last saved or read, to skip rewriting it when a snapshot brings nothing new. */
  const savedStateRef = useRef<string | undefined>(undefined);
  /** A save waiting for the screen to settle; run at once when the chat is left. */
  const saveRef = useRef<(() => void) | null>(null);
  /** A prompt the daemon has not accepted yet, restored to the box if it refuses it. */
  const pending = useRef<{ text: string; attachments: Attachment[] } | null>(null);
  /** Effects follow the computer by how it is reached, not by object: a rename must not reconnect. */
  const link = `${machine.id}\n${machine.url}\n${machine.token}`;
  const machineRef = useRef(machine);
  machineRef.current = machine;
  /** The daemon's features as last fetched, read where the socket is (re)built. */
  const featuresRef = useRef<string[]>([]);
  featuresRef.current = features;

  // Asked again whenever the link comes up: the computer may not have been reachable when the chat opened.
  useEffect(() => {
    if (!connected && features.length > 0) return undefined;
    let cancelled = false;
    void daemonFeatures(machineRef.current).then((list) => {
      if (cancelled || list.length === 0) return;
      setFeatures(list);
      // A daemon that beats: silence means the socket died, not that the session is quiet.
      if (list.includes("heartbeat")) socketRef.current?.watchSilence();
    });
    return () => {
      cancelled = true;
    };
    // `features` only gates the call; a fetched list must not trigger another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, connected]);

  // Leaving the chat: the pending save first, then the copy is brought up to date
  // with what arrived live (the daemon's slim messages, not the live events).
  useEffect(
    () => () => {
      saveRef.current?.();
      saveRef.current = null;
      if (live.current) void refreshTranscript(machineRef.current, initialSession.id).catch(() => undefined);
    },
    [initialSession.id],
  );

  /** Put a window on screen; ids are those of the whole transcript, so the rows a tail showed keep theirs. */
  const show = useCallback((window: TranscriptWindow) => {
    windowRef.current = window;
    setItems(snapshotItems(window.messages, window.offset));
  }, []);
  /** Save what a snapshot brought, once the screen settled and the whole transcript is known. */
  const scheduleSave = useCallback(() => {
    const save = () => {
      if (saveRef.current === save) saveRef.current = null;
      const meta = unsavedRef.current;
      const window = windowRef.current;
      if (meta === null || window.offset !== 0) return;
      unsavedRef.current = null;
      saveCached(machineRef.current.id, initialSession.id, { ...meta, messages: window.messages }, true);
    };
    saveRef.current = save;
    setTimeout(save, 800);
  }, [initialSession.id]);

  useEffect(() => {
    let asking = false;
    const machine = machineRef.current;
    const socket = new SessionSocket(
      machine,
      initialSession.id,
      (message: ServerMessage) => {
        switch (message.type) {
          case "snapshot": {
            const sent = sentRef.current;
            let merged = mergeWindow(sent.window, sent.held, message);
            // Asked against the tail: put the whole copy under it, once it is read.
            if (merged !== undefined && merged.offset > 0 && headRef.current !== undefined) {
              merged = headRef.current === null ? undefined : attachHead(merged, headRef.current);
            }
            if (merged === undefined) {
              // It does not fit what it was asked against: keep showing the copy and ask for everything.
              wholeRef.current = true;
              socket.restart();
              break;
            }
            live.current = true;
            setSession(message.session);
            setState(message.state);
            show(merged);
            const state = JSON.stringify(message.state ?? null);
            const changed = (message.from ?? 0) === 0 || message.messages.length > 0 || state !== savedStateRef.current;
            if (changed) {
              savedStateRef.current = state;
              unsavedRef.current = { updatedAt: message.session.updatedAt, session: message.session, state: message.state ?? null };
              scheduleSave();
            }
            break;
          }
          case "event": {
            setItems((current) => applyEvent(current, message.event));
            if (message.event.type === "turn_end" || message.event.type === "agent_end") {
              setState((current) => (current === null ? current : { ...current, isStreaming: false }));
            }
            break;
          }
          case "state":
            setState(message.state);
            break;
          case "models":
            setModels(message.models);
            setPickerLoading(false);
            break;
          case "thinking_levels":
            setLevels(message.levels);
            break;
          case "approval":
            // The keyboard would cover the sheet: OMP is waiting on this answer, not on a message.
            Keyboard.dismiss();
            setApproval(message.request);
            break;
          case "approval_resolved":
            setApproval((current) => (current?.id === message.id ? null : current));
            break;
          case "notice":
            setItems((current) => [
              ...current,
              { kind: "notice", id: `notice-${Date.now()}`, level: message.level, text: message.message },
            ]);
            break;
          case "accepted":
            if (message.command === "prompt") pending.current = null;
            break;
          case "closed":
            setConnected(false);
            setError(t("chat.stopped", { reason: message.reason }));
            break;
          case "error": {
            const refused = pending.current;
            // Older daemons do not name the command; then any error while a prompt is unanswered is taken as its refusal.
            if (refused !== null && (message.command === undefined || message.command === "prompt")) {
              // The daemon refused the prompt: give the text and photos back instead of losing them.
              pending.current = null;
              setDraft((current) => (current === "" ? refused.text : current));
              setAttachments((current) => (current.length === 0 ? refused.attachments : current));
              setState((current) => (current === null ? current : { ...current, isStreaming: false }));
            }
            setError(message.error);
            setPickerError(message.error);
            setPickerLoading(false);
            break;
          }
          case "protocol-error":
            setError(t("chat.protocolError"));
            break;
          default:
            break;
        }
      },
      () => {
        setConnected(true);
        setOpening(false);
        setFailure(null);
        setError(null);
      },
      (attempts) => {
        setConnected(false);
        setOpening(false);
        // A prompt unanswered when the link dropped is never answered on the new link: do not restore it later.
        pending.current = null;
        // An older daemon only refuses the upgrade; ask over HTTP why, once the retries pile up.
        if (attempts < ASK_AFTER || asking) return;
        asking = true;
        void openSession(machine, initialSession.id)
          .then(() => socket.reconnect())
          .catch((cause: unknown) => {
            if (cause instanceof HttpError && cause.status !== 401 && cause.status !== 403) {
              socket.fail();
              setFailure({ status: cause.status, error: cause.message, owner: cause.owner });
            }
          })
          .finally(() => {
            asking = false;
          });
      },
      (reason) => {
        setConnected(false);
        setOpening(false);
        setFailure(reason);
      },
      // The upgrade landed: the phone is connected, the session itself may still be starting.
      () => setOpening(true),
      // What the phone holds, for a daemon that sends deltas; asked at every (re)connect.
      () => {
        const window = windowRef.current;
        const whole = wholeRef.current;
        wholeRef.current = false;
        const syncs = featuresRef.current.includes("transcript-sync") || knownFeatures(machine).includes("transcript-sync");
        const held = whole || !syncs ? undefined : heldOfWindow(window);
        sentRef.current = { held, window };
        return held;
      },
    );
    socketRef.current = socket;
    if (featuresRef.current.includes("heartbeat")) socket.watchSilence();
    // The saved copy shows at once, offline too: its tail first (small whatever the session's
    // size), then the whole copy underneath. The socket connects once the first read settles,
    // so it asks for only what is new and the snapshot never lands before what it extends.
    let disposed = false;
    const paint = (saved: { session: SessionSummary; state: SessionState | null }) => {
      savedStateRef.current = JSON.stringify(saved.state ?? null);
      if (saved.state !== null) setState(saved.state);
      setSession((current) => (saved.session.updatedAt > current.updatedAt ? { ...current, ...saved.session } : current));
      markViewed(machine.id, initialSession.id);
    };
    /** The whole copy, read after the tail painted, goes under it; a copy that does not fit is never spliced. */
    const readHead = () => {
      void loadCached(machine.id, initialSession.id)
        .catch(() => undefined)
        .then((full) => {
          if (disposed) return;
          const window = windowRef.current;
          if (window.offset === 0) return;
          const attached = full === undefined ? undefined : attachHead(window, full.messages);
          if (attached === undefined) {
            headRef.current = null;
            // Only the tail is known: ask the daemon for the whole transcript.
            wholeRef.current = true;
            if (live.current || socket.isOpen) socket.restart();
            return;
          }
          headRef.current = full?.messages;
          quietRef.current = true;
          show(attached);
          if (unsavedRef.current !== null) scheduleSave();
        });
    };
    void loadTail(machine.id, initialSession.id)
      .catch(() => undefined)
      .then(async (tail) => {
        if (disposed) return;
        if (tail !== undefined && !live.current) {
          show({ offset: tail.from, messages: tail.messages });
          paint(tail);
          if (tail.from > 0) setTimeout(readHead, 250);
          else headRef.current = tail.messages;
        } else if (!live.current) {
          // No tail (an older copy): the whole copy, as before.
          const saved = await loadCached(machine.id, initialSession.id).catch(() => undefined);
          if (disposed) return;
          if (saved !== undefined && !live.current) {
            show({ offset: 0, messages: saved.messages });
            paint(saved);
          }
        }
        socket.connect();
      });
    // Back in the foreground: reconnect now rather than at the end of a backoff.
    // A session that could not open stays down until Retry, as the error card says.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && !failedRef.current) socket.reconnect();
    });
    return () => {
      disposed = true;
      subscription.remove();
      socket.close();
      socketRef.current = null;
    };
  }, [initialSession.id, link]);

  // This session is on screen: its background notifications are cleared and not posted.
  useEffect(() => {
    Attention.setOnScreen(machine.id, initialSession.id);
    return () => Attention.setOnScreen("", "");
  }, [initialSession.id, machine.id]);

  useEffect(() => {
    setOpening(false);
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 1_000);
    return () => clearTimeout(timer);
  }, [initialSession.id]);

  const streaming = state?.isStreaming === true;

  const send = useCallback(() => {
    const text = draft.trim();
    if ((text === "" && attachments.length === 0) || socketRef.current === null) return;
    const message =
      attachments.length > 0
        ? { type: "prompt", text, images: attachments.map((item) => ({ data: item.data, mimeType: item.mimeType })) }
        : { type: "prompt", text };
    if (!socketRef.current.send(message)) {
      setError(t("chat.notConnected"));
      return;
    }
    pending.current = { text: draft, attachments };
    setDraft("");
    setAttachments([]);
    setState((current) => (current === null ? current : { ...current, isStreaming: true }));
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [attachments, draft]);

  const abort = useCallback(() => {
    socketRef.current?.send({ type: "abort" });
  }, []);

  const attach = useCallback(
    (source: "library" | "camera") => {
      if (!features.includes("prompt-images")) {
        setError(t("chat.photosNeedUpdate"));
        return;
      }
      void pickPhotos(source, MAX_ATTACHMENTS - attachments.length)
        .then((picked) => {
          if (picked.length > 0) setAttachments((current) => [...current, ...picked].slice(0, MAX_ATTACHMENTS));
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    },
    [attachments.length, features],
  );
  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const answer = useCallback(
    (value: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (approval === null) return;
      socketRef.current?.send({ type: "approval", id: approval.id, ...value });
      setApproval(null);
    },
    [approval],
  );

  const openPicker = useCallback(() => {
    if (!connected) {
      setError(t("chat.notConnected"));
      return;
    }
    Keyboard.dismiss();
    setPickerError(null);
    setPicker(true);
    setPickerLoading(models === null);
    if (models === null) socketRef.current?.send({ type: "models" });
    socketRef.current?.send({ type: "thinking_levels" });
  }, [connected, models]);

  const selectModel = useCallback((model: ModelOption) => {
    setPicker(false);
    setPickerError(null);
    socketRef.current?.send({ type: "set_model", provider: model.provider, modelId: model.id });
    // The model's own thinking efforts decide the levels, so re-ask after the switch.
    socketRef.current?.send({ type: "thinking_levels" });
  }, []);

  const selectLevel = useCallback((level: string) => {
    setState((current) => (current === null ? current : { ...current, thinkingLevel: level }));
    socketRef.current?.send({ type: "set_thinking_level", level });
  }, []);

  const retry = useCallback(() => {
    setFailure(null);
    setTakeError(null);
    socketRef.current?.reconnect();
  }, []);

  /** Take the session from the omp that holds it on the computer, once the user confirmed; then open it here. */
  const takeOver = useCallback(() => {
    setTaking(true);
    setTakeError(null);
    void takeOverSession(machineRef.current, initialSession.id)
      .then(() => {
        setFailure(null);
        socketRef.current?.reconnect();
      })
      .catch((cause: unknown) => {
        setTakeError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof HttpError && cause.status === 409 && cause.owner !== undefined) {
          setFailure({ status: 409, error: cause.message, owner: cause.owner });
        }
      })
      .finally(() => setTaking(false));
  }, [initialSession.id]);

  // Rows newest first: the list is inverted, so it rests on the newest message and grows upward.
  const rows = useMemo(() => layoutRows(items).reverse(), [items]);
  /** The open step as it is now: a running tool's output keeps arriving while its sheet is open. */
  const openStep = useMemo(() => {
    if (step === null || step.kind !== "tool") return step;
    for (const row of rows) {
      if (row.kind !== "activity") continue;
      const found = row.steps.find((item) => item.kind === "tool" && item.tool.id === step.tool.id);
      if (found !== undefined) return found;
    }
    return step;
  }, [rows, step]);
  /** Rows on screen before the first live frame: they appear without an entrance. */
  /** Whether each row plays its entrance, decided once per id: rows loaded with the transcript do not, rows that arrive later do. */
  const seen = useRef<Map<string, boolean> | null>(null);
  if (seen.current === null && rows.length > 0) seen.current = new Map(rows.map((row) => [row.id, false]));
  if (quietRef.current && seen.current !== null) {
    // The older part of the copy, put under its tail: those rows were there already.
    for (const row of rows) if (!seen.current.has(row.id)) seen.current.set(row.id, false);
    quietRef.current = false;
  }
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const newest = rows[0]?.id;
  const lastNewest = useRef(newest);
  useEffect(() => {
    if (newest === lastNewest.current) return;
    lastNewest.current = newest;
    if (away) setUnseen((count) => count + 1);
  }, [away, newest]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const isAway = event.nativeEvent.contentOffset.y > NEAR_BOTTOM;
    setAway(isAway);
    if (!isAway) setUnseen(0);
  }, []);
  const jump = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseen(0);
  }, []);

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      const map = seen.current;
      let animate = map?.get(item.id);
      if (animate === undefined) {
        animate = map !== null;
        map?.set(item.id, animate);
      }
      return <TranscriptRow row={item} machine={machine} cwd={session.cwd} animate={animate} onOpenStep={setStep} />;
    },
    [machine, session.cwd],
  );

  const model = state?.model?.name ?? state?.model?.id ?? initialSession.model ?? t("chat.defaultModel");
  const level = state?.thinkingLevel;
  const usage = state?.contextUsage;
  const contextPercent =
    typeof usage?.percent === "number"
      ? usage.percent
      : usage?.tokens !== undefined && usage.contextWindow !== undefined && usage.contextWindow > 0
        ? (usage.tokens / usage.contextWindow) * 100
        : undefined;
  const queued = (state?.queuedMessages?.steering?.length ?? 0) + (state?.queuedMessages?.followUp?.length ?? 0);
  const todos = todoPhases(state?.todoPhases);
  const folder = session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd;
  // A session started here is named by the daemon after its first prompt; until the
  // next snapshot brings that name, take it from the transcript the same way.
  const firstPrompt = items.find((item) => item.kind === "message" && item.role === "user" && item.text.trim() !== "");
  const title =
    session.title === folder && firstPrompt?.kind === "message" ? firstPrompt.text.replace(/\s+/g, " ").trim().slice(0, 80) : session.title;
  const failed = failure === null ? null : failureText(failure);
  const offerTakeover = failure !== null && canTakeOver(failure.status, features);
  // A session a terminal holds is not broken: the card under the header says where it is and offers to take it.
  // "connecting" is about the link; while the link is up and the daemon is starting the
  // session, say "opening" -- the phone is connected either way. The first second shows
  // no word at all: a live session's socket opens in milliseconds.
  const status = offerTakeover
    ? "held"
    : failure !== null
      ? "failed"
      : connected
        ? streaming
          ? "working"
          : "live"
        : opening
          ? "opening"
          : settled
            ? "connecting"
            : "quiet";

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        // Android 15+ draws edge to edge, so the window no longer resizes for the keyboard; pad on both platforms.
        behavior="padding"
        keyboardVerticalOffset={insets.top}
      >
        <View style={styles.header}>
          <IconButton onPress={onBack} label={t("common.back")}>
            <BackGlyph size={22} color={colors.fgMuted} />
          </IconButton>
          <Pressable
            onPress={onSwitch}
            style={({ pressed }) => [styles.title, pressed && styles.titlePressed]}
            accessibilityRole="button"
            accessibilityLabel={t("chat.switchA11y", { title })}
            hitSlop={4}
          >
            <View style={styles.titleRow}>
              <Text style={styles.titleText} numberOfLines={1}>
                {title}
              </Text>
              <ChevronDownGlyph size={14} color={colors.fgGhost} />
            </View>
            <View style={styles.subtitleRow} accessible accessibilityLabel={t("common.pair", { label: displayName(machine), value: t(`chat.status.${status}`) })}>
              {status === "working" ? (
                <GradientDot size={7} />
              ) : status === "live" ? (
                <LiveDot color={colors.ok} size={7} />
              ) : status === "failed" ? (
                <LiveDot color={colors.err} size={7} />
              ) : status === "held" ? (
                <LiveDot color={colors.warn} size={7} />
              ) : status === "quiet" ? (
                <LiveDot color={colors.fgFaint} size={7} />
              ) : (
                <PulseDot color={colors.warn} size={7} />
              )}
              <Text style={styles.subtitle} numberOfLines={1}>
                {displayName(machine)} ·{" "}
                {status === "opening"
                  ? t("chat.opening")
                  : status === "connecting"
                    ? t("chat.connecting")
                    : status === "failed"
                      ? t("chat.cannotOpen")
                      : folder}
              </Text>
            </View>
          </Pressable>
        </View>

        {error !== null ? <Banner text={error} onPress={() => setError(null)} /> : null}

        {failure !== null && offerTakeover ? (
          <View style={styles.failure}>
            <View style={styles.held}>
              <WarningGlyph size={18} color={colors.warn} />
              <Text style={[styles.failureBody, styles.heldText]}>{heldLine(failure.owner)}</Text>
            </View>
            {takeError !== null ? (
              <Text style={styles.takeError} selectable>
                {takeError}
              </Text>
            ) : null}
            {taking ? (
              <View style={styles.taking}>
                <Spinner size={12} color={colors.fgMuted} />
                <Text style={styles.failureBody}>{t("chat.takeover.working")}</Text>
              </View>
            ) : (
              <Pressable onPress={() => setConfirmTake(true)} style={({ pressed }) => [styles.failureButton, pressed && styles.titlePressed]} accessibilityRole="button">
                <Text style={styles.failureButtonText}>{t("chat.takeover.action")}</Text>
              </Pressable>
            )}
          </View>
        ) : failed !== null && failure !== null ? (
          <View style={styles.failure}>
            <WarningGlyph size={20} color={colors.warn} />
            <Text style={styles.failureTitle}>{failed.title}</Text>
            {failed.body !== undefined ? <Text style={styles.failureBody}>{failed.body}</Text> : null}
            <View style={styles.failureCode}>
              <Text style={styles.failureCodeText} selectable>
                {failure.status} · {failure.error}
              </Text>
            </View>
            <Pressable onPress={retry} style={({ pressed }) => [styles.failureButton, pressed && styles.titlePressed]} accessibilityRole="button">
              <Text style={styles.failureButtonText}>{t("common.tryAgain")}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            inverted
            data={rows}
            keyExtractor={keyOf}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={64}
            contentContainerStyle={styles.list}
            style={failure !== null ? styles.listDim : undefined}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            // At the bottom the inverted list keeps the newest row pinned while it streams and grows.
            // Scrolled up, the rows in view stay put while new ones arrive below.
            maintainVisibleContentPosition={away ? { minIndexForVisible: 0 } : undefined}
            initialNumToRender={14}
            windowSize={11}
          />
          {rows.length === 0 && failure === null ? (
            // Outside the list: an inverted list flips its children on both axes on Android.
            <View style={styles.emptyOverlay} pointerEvents="none">
              <View style={connected ? styles.emptyMark : styles.emptyMarkWaiting}>
                <BrandMark size={26} />
              </View>
            </View>
          ) : null}
          {away ? (
            <Pressable onPress={jump} style={styles.jump} accessibilityRole="button" accessibilityLabel={t("chat.jumpA11y")}>
              <ArrowDownGlyph size={13} color={colors.fgMuted} />
              <Text style={styles.jumpText}>{unseen > 0 ? t("chat.unseen", { count: unseen }) : t("chat.latest")}</Text>
            </Pressable>
          ) : null}
        </View>

        <TodoPanel phases={todos} />

        <Composer
          draft={draft}
          onChangeDraft={setDraft}
          attachments={attachments}
          onRemoveAttachment={removeAttachment}
          onAttach={attach}
          canAttach={features.includes("prompt-images")}
          streaming={streaming}
          connected={connected}
          readOnly={failure !== null}
          onSend={send}
          onStop={abort}
          model={model}
          level={level}
          contextPercent={contextPercent}
          queued={queued}
          onModel={openPicker}
          bottomInset={keyboard ? 0 : insets.bottom}
        />
      </KeyboardAvoidingView>

      {approval !== null ? <ApprovalSheet request={approval} onAnswer={answer} /> : null}
      <ModelSheet
        visible={picker}
        models={models}
        levels={levels}
        current={state?.model}
        level={level}
        loading={pickerLoading}
        error={pickerError}
        onClose={() => setPicker(false)}
        onSelectModel={selectModel}
        onSelectLevel={selectLevel}
      />
      <ConfirmSheet
        visible={confirmTake}
        title={t("chat.takeover.confirmTitle")}
        body={confirmBody(failure?.owner)}
        action={t("chat.takeover.action")}
        danger={failure?.owner?.busy === true}
        onConfirm={takeOver}
        onClose={() => setConfirmTake(false)}
      />
      <ToolSheet step={openStep} machine={machine} cwd={session.cwd} onClose={() => setStep(null)} />
    </View>
  );
}

function keyOf(row: Row): string {
  return row.id;
}

/** Whether the software keyboard is up; the composer drops the home-indicator inset meanwhile. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function createStyles(c: Palette) {
  const emptyMark = {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      height: 58,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 2,
      paddingRight: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.bg,
    },
    title: { flex: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.md, gap: 2 },
    titlePressed: { opacity: 0.6 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
    titleText: { flexShrink: 1, fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.2, color: c.fg },
    subtitleRow: { flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 },
    subtitle: { flexShrink: 1, fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },

    listWrap: { flex: 1 },
    list: { paddingTop: 12, paddingBottom: 8 },
    listDim: { opacity: 0.5 },
    emptyOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
    emptyMark,
    emptyMarkWaiting: { ...emptyMark, opacity: 0.45 },
    jump: {
      position: "absolute",
      alignSelf: "center",
      bottom: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 32,
      paddingHorizontal: 13,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      backgroundColor: c.raised,
      elevation: 6,
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    jumpText: { fontFamily: SANS, fontSize: 12.5, lineHeight: 16, fontWeight: "500", color: c.fgMuted },

    failure: {
      margin: 14,
      padding: 16,
      gap: 8,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.dark ? "#f5a52455" : "#c77c0255",
      backgroundColor: c.warnSoft,
    },
    failureTitle: { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600", color: c.fg, marginTop: 4 },
    failureBody: { fontFamily: SANS, fontSize: 14, lineHeight: 21, color: c.fgMuted },
    failureCode: { borderRadius: radius.md, backgroundColor: c.inset, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 10 },
    failureCodeText: { fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: c.fgFaint },
    failureButton: {
      alignSelf: "flex-start",
      marginTop: 4,
      height: 38,
      paddingHorizontal: 16,
      borderRadius: radius.md,
      justifyContent: "center",
      backgroundColor: c.fg,
    },
    failureButtonText: { fontFamily: SANS, fontSize: 14, fontWeight: "600", color: c.bg },
    held: { flexDirection: "row", gap: 10, alignItems: "center" },
    heldText: { flex: 1, color: c.fg },
    taking: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 4, minHeight: 38 },
    takeError: { fontFamily: SANS, fontSize: 13, lineHeight: 19, color: c.err },
  } as const;
}
