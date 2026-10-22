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
import { ChatGlyph, SendGlyph, StopGlyph } from "../components/icons";
import { Banner, EmptyState, Header } from "../components/ui";
import { applyEvent, snapshotItems } from "../messages";
import { radius, useColors, useStyles, type Palette } from "../theme";
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
            <View style={styles.subtitle}>
              <View style={connected ? (streaming ? styles.dotBusy : styles.dotLive) : styles.dotOff} />
              <Text style={styles.subtitleText} numberOfLines={1}>
                {connected ? (streaming ? "working · " : "") + model : "reconnecting…"} · {folder}
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
              icon={<ChatGlyph size={26} color={colors.textSecondary} />}
              title="Ask OMP anything"
              body={`It runs on ${machine.name} in ${folder}. Tool calls and approvals appear here as it works.`}
            />
          }
        />

        <View style={[styles.composer, { paddingBottom: 8 + (keyboard ? 0 : insets.bottom) }]}>
          <View style={styles.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={streaming ? "Steer the current turn…" : "Message OMP"}
              placeholderTextColor={colors.textTertiary}
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
                <StopGlyph size={12} color="#FFFFFF" />
              ) : (
                <SendGlyph size={18} color={actionDisabled ? colors.textTertiary : colors.onPrimary} />
              )}
            </Pressable>
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

/** Six lines of 22 px text plus the vertical padding. */
const INPUT_MAX = 22 * 6 + 20;
const ACTION = 34;

function createStyles(c: Palette) {
  const dot = { width: 6, height: 6, borderRadius: 3 } as const;
  const action = {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
    marginRight: 5,
  } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    subtitle: { flexDirection: "row", alignItems: "center", gap: 5 },
    subtitleText: { flexShrink: 1, fontSize: 12, lineHeight: 16, color: c.textTertiary },
    dotLive: { ...dot, backgroundColor: c.success },
    dotBusy: { ...dot, backgroundColor: c.warn },
    dotOff: { ...dot, backgroundColor: c.textTertiary },
    list: { paddingVertical: 12, flexGrow: 1 },
    composer: {
      paddingHorizontal: 12,
      paddingTop: 8,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.separator,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "flex-end",
      borderRadius: radius.xl + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: INPUT_MAX,
      paddingLeft: 16,
      paddingRight: 8,
      paddingTop: 11,
      paddingBottom: 11,
      fontSize: 16,
      lineHeight: 22,
      color: c.text,
      textAlignVertical: "top",
    },
    send: { ...action, backgroundColor: c.primary },
    sendOff: { ...action, backgroundColor: c.raised },
    stop: { ...action, backgroundColor: c.danger },
    actionPressed: { opacity: 0.8 },
  } as const;
}
