import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionSocket } from "../api";
import { ApprovalSheet } from "../components/ApprovalSheet";
import { ChatItem } from "../components/ChatItem";
import { BrandMark, GradientDot, GradientFill, LiveDot, PulseDot } from "../components/brand";
import { SendGlyph, StopGlyph } from "../components/icons";
import { Banner, Chip, EmptyState, Header } from "../components/ui";
import { applyEvent, snapshotItems } from "../messages";
import { MONO, radius, useColors, useStyles, type Palette } from "../theme";
import type {
  ApprovalRequest,
  ChatItem as Item,
  Machine,
  ServerMessage,
  SessionState,
  SessionSummary,
} from "../types";

interface Props {
  machine: Machine;
  session: SessionSummary;
  onBack: () => void;
}

export function ChatScreen({ machine, session: initialSession, onBack }: Props): ReactNode {
  const colors = useColors();
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const listRef = useRef<FlatList<Item>>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  const [session, setSession] = useState(initialSession);
  const [state, setState] = useState<SessionState | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    const socket = new SessionSocket(
      machine,
      initialSession.id,
      (message: ServerMessage) => {
        switch (message.type) {
          case "snapshot":
            setSession(message.session);
            setState(message.state);
            setItems(snapshotItems(message.messages));
            break;
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
          case "approval":
            setApproval(message.request);
            break;
          case "notice":
            setItems((current) => [
              ...current,
              { kind: "notice", id: `notice-${Date.now()}`, level: message.level, text: message.message },
            ]);
            break;
          case "closed":
            setConnected(false);
            setError(`OMP closed: ${message.reason}`);
            break;
          case "error":
            setError(message.error);
            break;
          case "protocol-error":
            setError("The daemon sent an unreadable OMP frame.");
            break;
          default:
            break;
        }
      },
      () => {
        setConnected(true);
        setError(null);
      },
      () => setConnected(false),
    );
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [initialSession.id, machine]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text === "" || socketRef.current === null) return;
    socketRef.current.send({ type: "prompt", text });
    setDraft("");
    setState((current) => (current === null ? current : { ...current, isStreaming: true }));
  }, [draft]);

  const abort = useCallback(() => {
    socketRef.current?.send({ type: "abort" });
  }, []);

  const answer = useCallback(
    (value: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (approval === null) return;
      socketRef.current?.send({ type: "approval", id: approval.id, ...value });
      setApproval(null);
    },
    [approval],
  );

  const streaming = state?.isStreaming === true;
  const model = state?.model?.name ?? state?.model?.id ?? initialSession.model ?? "default model";
  const folder = session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd;
  const hasText = draft.trim() !== "";
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  // Text in the box sends (a steer while streaming); an empty box while streaming stops the turn.
  const mode: "send" | "stop" | "idle" = hasText ? "send" : streaming ? "stop" : "idle";
  const actionDisabled = !connected || mode === "idle";
  const action = mode === "stop" ? abort : send;
  const actionStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      mode === "stop" ? styles.stop : actionDisabled ? styles.sendOff : styles.send,
      pressed && styles.actionPressed,
    ],
    [actionDisabled, mode, styles],
  );
  const renderItem = useCallback<ListRenderItem<Item>>(({ item }) => <ChatItem item={item} />, []);
  const scrollToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <Header
          title={session.title}
          onBack={onBack}
          subtitle={
            <Text style={styles.subtitle} numberOfLines={1}>
              {model} · {folder}
            </Text>
          }
          right={
            <View
              style={styles.status}
              accessible
              accessibilityLabel={connected ? (streaming ? "Working" : "Connected") : "Reconnecting"}
            >
              {connected ? (
                streaming ? (
                  <GradientDot size={7} />
                ) : (
                  <LiveDot color={colors.ok} size={7} ping />
                )
              ) : (
                <PulseDot color={colors.warn} size={7} />
              )}
              <Text style={connected ? styles.statusText : styles.statusTextOff}>
                {connected ? (streaming ? "working" : "live") : "offline"}
              </Text>
            </View>
          }
        />

        {error !== null ? <Banner text={error} onPress={() => setError(null)} /> : null}

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={keyOf}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          ListEmptyComponent={
            <EmptyState
              icon={<BrandMark size={26} />}
              title="Ask OMP anything"
              body={`It runs on ${machine.name} in ${folder}. Tool calls and approvals appear here as it works.`}
            />
          }
        />

        <View style={[styles.composer, { paddingBottom: 10 + (keyboard ? 0 : insets.bottom) }]}>
          <View style={styles.chips}>
            <Chip label={model} />
            <View style={styles.chipShrink}>
              <Chip label={session.cwd} />
            </View>
          </View>
          <View style={focused ? styles.haloOn : styles.halo}>
            <View style={focused ? styles.inputWrapFocused : styles.inputWrap}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onFocus={focus}
                onBlur={blur}
                placeholder={streaming ? "Steer the current turn…" : "Message OMP"}
                placeholderTextColor={colors.fgFaint}
                selectionColor={colors.ring}
                multiline
                style={styles.input}
              />
              <Pressable
                onPress={action}
                disabled={actionDisabled}
                accessibilityRole="button"
                accessibilityLabel={mode === "stop" ? "Stop" : "Send"}
                hitSlop={6}
                style={actionStyle}
              >
                {mode === "stop" ? (
                  <StopGlyph size={11} color={colors.err} />
                ) : (
                  <>
                    {actionDisabled ? null : <GradientFill />}
                    <SendGlyph size={17} color={actionDisabled ? colors.fgFaint : "#FFFFFF"} />
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {approval !== null ? <ApprovalSheet request={approval} onAnswer={answer} /> : null}
    </View>
  );
}

function keyOf(item: Item): string {
  return item.id;
}

/** Whether the software keyboard is up; the composer drops the home-indicator inset meanwhile. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Six lines of 21 px text plus the vertical padding. */
const INPUT_MAX = 21 * 6 + 20;
const ACTION = 32;

function createStyles(c: Palette) {
  const action = {
    width: ACTION,
    height: ACTION,
    borderRadius: radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    marginRight: 6,
  } as const;
  const status = {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 24,
    paddingHorizontal: 9,
    marginRight: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.raised,
  } as const;
  const statusText = { fontFamily: MONO, fontSize: 11, lineHeight: 14, color: c.fgMuted } as const;
  const inputWrap = {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    borderTopColor: c.edgeTop,
    backgroundColor: c.raised,
  } as const;
  const halo = { borderRadius: radius.lg + 3, borderWidth: 3, margin: -3, borderColor: "transparent" } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    subtitle: { flexShrink: 1, fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    status,
    statusText,
    statusTextOff: { ...statusText, color: c.warn },
    list: { paddingTop: 6, paddingBottom: 16, flexGrow: 1 },
    composer: { paddingHorizontal: 12, paddingTop: 6, gap: 8, backgroundColor: c.bg },
    chips: { flexDirection: "row", gap: 6, paddingHorizontal: 2 },
    chipShrink: { flexShrink: 1, minWidth: 0 },
    halo,
    haloOn: { ...halo, borderColor: c.ringSoft },
    inputWrap,
    inputWrapFocused: { ...inputWrap, borderColor: c.ring, borderTopColor: c.ring },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: INPUT_MAX,
      paddingLeft: 14,
      paddingRight: 8,
      paddingTop: 11,
      paddingBottom: 11,
      fontSize: 15,
      lineHeight: 21,
      color: c.fg,
      textAlignVertical: "top",
    },
    send: action,
    sendOff: { ...action, backgroundColor: c.selected },
    stop: {
      ...action,
      backgroundColor: c.errSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.errBorder,
    },
    actionPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  } as const;
}
