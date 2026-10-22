import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SessionSocket } from "../api";
import { ApprovalSheet } from "../components/ApprovalSheet";
import { ChatItem } from "../components/ChatItem";
import { applyEvent, snapshotItems } from "../messages";
import { radius, type, useColors } from "../theme";
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
  const styles = useStyles(colors);
  const listRef = useRef<import("react-native").FlatList<Item>>(null);
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
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <View style={[styles.header, { borderBottomColor: colors.separator }]}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={{ color: colors.textSecondary, fontSize: 28, marginTop: -4 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
            {session.title}
          </Text>
          <Text style={[type.tiny, { color: colors.textTertiary }]} numberOfLines={1}>
            {connected ? model : "reconnecting…"} · {session.cwd.split("/").filter(Boolean).at(-1) ?? session.cwd}
          </Text>
        </View>
        {streaming ? (
          <Pressable onPress={abort} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop">
            <Text style={[type.small, { color: colors.danger, fontWeight: "600" }]}>Stop</Text>
          </Pressable>
        ) : (
          <View style={[styles.liveDot, { backgroundColor: connected ? colors.success : colors.textTertiary }]} />
        )}
      </View>

      {error !== null ? (
        <Pressable onPress={() => setError(null)} style={[styles.banner, { backgroundColor: colors.dangerSoft }]}>
          <Text style={[type.small, { color: colors.danger }]}>{error}</Text>
        </Pressable>
      ) : null}

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ChatItem item={item} />}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[type.heading, { color: colors.text }]}>Ask OMP anything</Text>
            <Text style={[type.body, { color: colors.textSecondary, textAlign: "center", marginTop: 8 }]}>
              It runs on {machine.name}. Tool calls and approvals appear here as it works.
            </Text>
          </View>
        }
      />

      <View style={[styles.composer, { backgroundColor: colors.bg, borderTopColor: colors.separator }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={streaming ? "Steer the current turn…" : "Message OMP"}
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[
            styles.input,
            type.body,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        />
        <Pressable
          onPress={send}
          disabled={draft.trim() === "" || !connected}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[
            styles.send,
            { backgroundColor: draft.trim() === "" || !connected ? colors.raised : colors.primary },
          ]}
        >
          <Text
            style={{
              color: draft.trim() === "" || !connected ? colors.textTertiary : colors.onPrimary,
              fontSize: 18,
              fontWeight: "700",
            }}
          >
            ↑
          </Text>
        </Pressable>
      </View>

      {approval !== null ? <ApprovalSheet request={approval} onAnswer={answer} /> : null}
    </KeyboardAvoidingView>
  );
}

function useStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    banner: { paddingHorizontal: 16, paddingVertical: 8 },
    list: { paddingVertical: 14, flexGrow: 1 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, paddingTop: 100 },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: Platform.OS === "ios" ? 24 : 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    input: {
      flex: 1,
      maxHeight: 150,
      minHeight: 42,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    send: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  });
}
