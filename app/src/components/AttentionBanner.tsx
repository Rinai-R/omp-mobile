import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attention } from "../../modules/omp-attention/src";
import { SANS, EASE_OUT, MONO, radius, useColors, useStyles, type Palette } from "../theme";
import { GradientDot, LiveDot } from "./brand";
import { CloseGlyph } from "./icons";

const HEADLINE: Record<string, string> = {
  approval: "Approval needed",
  question: "Question for you",
  done: "Turn finished",
  failed: "Turn failed",
};

/** Waiting items stay until handled; results slide away after a few seconds. */
const RESULT_MS = 6_000;

interface Props {
  attention: Attention;
  onOpen: (attention: Attention) => void;
  onDismiss: (attention: Attention) => void;
}

/** In-app pop-up for a session that is not on screen: an overlay card under the status bar. */
export function AttentionBanner({ attention, onOpen, onDismiss }: Props): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const waiting = attention.kind === "approval" || attention.kind === "question";

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 320, easing: EASE_OUT, useNativeDriver: true }).start();
    if (waiting) return undefined;
    const timer = setTimeout(() => onDismiss(attention), RESULT_MS);
    return () => clearTimeout(timer);
  }, [attention, onDismiss, slide, waiting]);

  const position = useMemo(
    () => [
      styles.wrap,
      {
        top: insets.top + 8,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      },
    ],
    [insets.top, slide, styles.wrap],
  );
  const open = useCallback(() => onOpen(attention), [attention, onOpen]);
  const dismiss = useCallback(() => onDismiss(attention), [attention, onDismiss]);
  const headline = HEADLINE[attention.kind] ?? "Session";
  const title = attention.sessionTitle || "Session";

  return (
    <Animated.View style={position} pointerEvents="box-none">
      <Pressable
        onPress={open}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${headline}: ${title}. Open`}
      >
        <View style={styles.dot}>
          {waiting ? (
            <GradientDot size={8} />
          ) : (
            <LiveDot color={attention.kind === "failed" ? colors.err : colors.ok} size={8} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.headline} numberOfLines={1}>
            {headline} · {title}
          </Text>
          {attention.text !== "" ? (
            <Text style={styles.detail} numberOfLines={2}>
              {attention.text}
            </Text>
          ) : null}
          <Text style={styles.machine} numberOfLines={1}>
            {attention.machineName}
          </Text>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={12}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <CloseGlyph size={15} color={colors.fgFaint} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(c: Palette) {
  return {
    wrap: { position: "absolute", left: 12, right: 12, zIndex: 100, alignItems: "center" },
    card: {
      width: "100%",
      maxWidth: 600,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 11,
      paddingVertical: 11,
      paddingLeft: 14,
      paddingRight: 10,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      borderTopColor: c.edgeTop,
      backgroundColor: c.overlay,
      elevation: 8,
      shadowColor: "#000",
      shadowOpacity: c.dark ? 0.5 : 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    pressed: { backgroundColor: c.raised },
    dot: { paddingTop: 6 },
    body: { flex: 1, minWidth: 0, gap: 2 },
    headline: { fontFamily: SANS, fontSize: 14, lineHeight: 19, fontWeight: "600", letterSpacing: -0.1, color: c.fg },
    detail: { fontFamily: SANS, fontSize: 13, lineHeight: 18, color: c.fgMuted },
    machine: { fontFamily: MONO, fontSize: 11, lineHeight: 15, color: c.fgFaint },
    close: { padding: 4 },
  } as const;
}
