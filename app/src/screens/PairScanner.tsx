import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { pairMachine } from "../api";
import { CloseGlyph, KeyboardGlyph } from "../components/icons";
import { pairingMessage, readPairing } from "../pairing";
import { EASE_OUT, GRADIENT, MONO, SANS, palette, radius } from "../theme";
import type { Machine } from "../types";

interface Props {
  machines: Machine[];
  /** A checked machine to save; the caller also leaves the scanner. */
  onAdd: (machine: Machine) => void;
  onClose: () => void;
  /** Leave the scanner for the manual Add machine sheet. */
  onManual: () => void;
}

const QR_ONLY = { barcodeTypes: ["qr" as const] };
/** The camera screen is always dark, whatever the system scheme. */
const DARK = palette("dark");
const HIT_SLOP = 8;
/** A code is handled again only after it has been out of view this long. */
const SAME_CODE_MS = 1500;

type Access = "pending" | "live" | "denied" | "failed";

/** Camera permission as one state, asked once on open and re-read on return from settings. */
function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [requesting, setRequesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  const ask = useCallback(() => {
    setRequesting(true);
    setFailed(false);
    void requestPermission()
      .catch(() => setFailed(true))
      .finally(() => setRequesting(false));
  }, [requestPermission]);

  useEffect(() => {
    if (permission?.status === "undetermined" && !requested.current) {
      requested.current = true;
      ask();
    }
  }, [permission?.status, ask]);

  // Permission granted in system settings shows the camera on return.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission().catch(() => setFailed(true));
    });
    return () => subscription.remove();
  }, [getPermission]);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => setFailed(true));
  }, []);

  let access: Access = "pending";
  if (failed) access = "failed";
  else if (requesting || permission === null) access = "pending";
  else if (permission.granted) access = "live";
  else if (permission.status !== "undetermined") access = "denied";
  return { access, ask, openSettings };
}

/**
 * Scanned codes, one at a time: refuse anything but a tailnet pairing code with
 * an inline error and keep scanning; check an accepted one and add it.
 */
function usePairing(machines: Machine[], onAdd: (machine: Machine) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  /** The last code seen and when: the camera reports a code in view many times a second. */
  const last = useRef<{ data: string; at: number } | null>(null);
  const active = useRef(true);
  const machinesRef = useRef(machines);
  machinesRef.current = machines;
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  const scan = useCallback(
    ({ type, data }: BarcodeScanningResult) => {
      if (type !== "qr") return;
      const now = Date.now();
      const previous = last.current;
      last.current = { data, at: now };
      // Held in view, the same code is one scan; shown again later, it is a new one.
      if (working.current || (previous !== null && previous.data === data && now - previous.at < SAME_CODE_MS)) return;
      const pairing = readPairing(data);
      if (!pairing.ok) {
        setError(pairingMessage(pairing.problem, pairing.host));
        return;
      }
      working.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const machine = await pairMachine(pairing.url, pairing.token, machinesRef.current);
          if (active.current) onAdd(machine);
        } catch (failure) {
          if (active.current) setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          // The check took a while: the code still in view counts from now, not as a new scan.
          if (last.current?.data === data) last.current = { data, at: Date.now() };
          working.current = false;
          if (active.current) setBusy(false);
        }
      })();
    },
    [onAdd],
  );
  return { error, busy, scan };
}

/** Full-screen QR scanner for the pairing code the daemon prints. */
export function PairScanner({ machines, onAdd, onClose, onManual }: Props): ReactNode {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const camera = useCameraAccess();
  const pairing = usePairing(machines, onAdd);
  /** The camera granted but failed to start; a retry remounts it under a new key. */
  const [mountFailed, setMountFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountError = useCallback(() => setMountFailed(true), []);
  const remount = useCallback(() => {
    setMountFailed(false);
    setAttempt((value) => value + 1);
  }, []);

  const frame = Math.min(Math.round(width * 0.68), 300);
  const layout = useMemo(
    () =>
      StyleSheet.create({
        top: { ...styles.top, paddingTop: insets.top + 8 },
        bottom: { ...styles.bottom, paddingBottom: insets.bottom + 24 },
        frame: { width: frame, height: frame },
      }),
    [frame, insets.bottom, insets.top],
  );

  let panel: ReactNode = null;
  if (camera.access === "failed") {
    panel = <Problem message="The camera is not available." action="Try again" onAction={camera.ask} onManual={onManual} />;
  } else if (camera.access === "denied") {
    panel = (
      <Problem
        message="OMP needs camera access to scan the pairing code. Allow it in Settings, or enter the address by hand."
        action="Open settings"
        onAction={camera.openSettings}
        onManual={onManual}
      />
    );
  } else if (camera.access === "live" && mountFailed) {
    panel = <Problem message="The camera could not start." action="Try again" onAction={remount} onManual={onManual} />;
  }

  return (
    <View style={styles.root}>
      {camera.access === "live" && !mountFailed ? (
        <CameraView
          key={attempt}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={QR_ONLY}
          onBarcodeScanned={pairing.scan}
          onMountError={mountError}
        />
      ) : null}
      <View style={styles.center} pointerEvents="none">
        <View style={layout.frame}>
          <FrameCorners size={frame} />
          {pairing.busy || camera.access === "pending" ? (
            <View style={styles.busy}>
              <ActivityIndicator color={DARK.fg} />
              {pairing.busy ? <Text style={styles.busyText}>connecting…</Text> : null}
            </View>
          ) : camera.access === "live" && !mountFailed && panel === null ? (
            <ScanLine size={frame} />
          ) : null}
        </View>
      </View>
      <View style={layout.top}>
        <Pressable
          onPress={onClose}
          hitSlop={HIT_SLOP}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <CloseGlyph size={16} color={DARK.fg} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Scan to pair</Text>
          <Text style={styles.subtitle}>omp-mobile daemon</Text>
        </View>
        <View style={styles.iconSpacer} />
      </View>
      <View style={layout.bottom}>
        {panel ?? (
          <>
            {pairing.error !== null ? (
              <Text style={styles.error} accessibilityRole="alert">
                {pairing.error}
              </Text>
            ) : null}
            <Text style={styles.hint}>Point the camera at the QR code the omp-mobile daemon prints in its terminal.</Text>
            <Pressable onPress={onManual} style={styles.ghost} accessibilityRole="button">
              <KeyboardGlyph color={DARK.fgMuted} />
              <Text style={styles.ghostText}>Enter address</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/** Problem card over the camera area: the scanner stays recognisable behind it. */
function Problem({
  message,
  action,
  onAction,
  onManual,
}: {
  message: string;
  action: string;
  onAction: () => void;
  onManual: () => void;
}): ReactNode {
  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetText}>{message}</Text>
      <View style={styles.sheetActions}>
        <Pressable onPress={onManual} style={styles.sheetSecondary} accessibilityRole="button">
          <Text style={styles.sheetSecondaryText}>Enter address</Text>
        </Pressable>
        <Pressable onPress={onAction} style={styles.sheetPrimary} accessibilityRole="button">
          <Text style={styles.sheetPrimaryText}>{action}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const CORNER = 26;
const STROKE = 3;

/** The four corners of the scan frame, drawn in the brand gradient. */
function FrameCorners({ size }: { size: number }): ReactNode {
  const r = radius.lg;
  const h = STROKE / 2;
  const far = size - h;
  const d = [
    `M${h} ${CORNER}V${r + h}Q${h} ${h} ${r + h} ${h}H${CORNER}`,
    `M${size - CORNER} ${h}H${far - r}Q${far} ${h} ${far} ${r + h}V${CORNER}`,
    `M${h} ${size - CORNER}V${far - r}Q${h} ${far} ${r + h} ${far}H${CORNER}`,
    `M${size - CORNER} ${far}H${far - r}Q${far} ${far} ${far} ${far - r}V${size - CORNER}`,
  ].join("");
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="frame" {...GRADIENT}>
          <Stop offset="0" stopColor={DARK.accentA} />
          <Stop offset="1" stopColor={DARK.accentB} />
        </LinearGradient>
      </Defs>
      <Path d={d} stroke="url(#frame)" strokeWidth={STROKE} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** A faint gradient line that sweeps down the frame while the camera looks. */
function ScanLine({ size }: { size: number }): ReactNode {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 2200, easing: EASE_OUT, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  const inset = 14;
  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [inset, size - inset] });
  const opacity = value.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 0.9, 0.9, 0] });
  return (
    <Animated.View style={[styles.scanLine, { left: inset, right: inset, opacity, transform: [{ translateY }] }]}>
      <Svg width="100%" height={2} preserveAspectRatio="none" viewBox="0 0 100 2">
        <Defs>
          <LinearGradient id="line" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={DARK.accentA} stopOpacity={0} />
            <Stop offset="0.3" stopColor={DARK.accentA} />
            <Stop offset="0.7" stopColor={DARK.accentB} />
            <Stop offset="1" stopColor={DARK.accentB} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d="M0 1H100" stroke="url(#line)" strokeWidth={2} />
      </Svg>
    </Animated.View>
  );
}

/** Translucent chrome over the camera, like my.omp.sh's glass bars. */
const GLASS = "#0e0e10c7";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK.bg },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  busy: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  busyText: { color: DARK.fgMuted, fontFamily: MONO, fontSize: 12 },
  scanLine: { position: "absolute", top: 0, height: 2 },
  top: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: GLASS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.border,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.borderStrong,
  },
  iconSpacer: { width: 36 },
  titleBlock: { alignItems: "center", gap: 1 },
  title: { fontFamily: SANS, color: DARK.fg, fontSize: 15, lineHeight: 20, fontWeight: "600", letterSpacing: -0.15 },
  subtitle: { color: DARK.fgFaint, fontFamily: MONO, fontSize: 11, lineHeight: 15 },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    backgroundColor: GLASS,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DARK.edgeTop,
  },
  hint: { fontFamily: SANS, color: DARK.fgMuted, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 340 },
  error: {
    alignSelf: "stretch",
    color: DARK.err,
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.errBorder,
    backgroundColor: DARK.errSoft,
    overflow: "hidden",
  },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: DARK.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.borderStrong,
  },
  ghostText: { fontFamily: SANS, color: DARK.fg, fontSize: 14, fontWeight: "500" },
  sheet: {
    alignSelf: "stretch",
    padding: 16,
    gap: 14,
    borderRadius: radius.xl,
    backgroundColor: DARK.overlay,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.borderStrong,
    borderTopColor: DARK.edgeTop,
  },
  sheetText: { fontFamily: SANS, color: DARK.fg, fontSize: 14, lineHeight: 21 },
  sheetActions: { flexDirection: "row", gap: 10 },
  sheetSecondary: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.borderStrong,
  },
  sheetSecondaryText: { fontFamily: SANS, color: DARK.fg, fontSize: 15, fontWeight: "500" },
  sheetPrimary: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.accent,
  },
  sheetPrimaryText: { fontFamily: SANS, color: DARK.accentFg, fontSize: 15, fontWeight: "600" },
});
