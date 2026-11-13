/**
 * Pairing with a DSH Remote computer from its code, on screen: the hook that
 * runs the steps (`dsh/pair.ts`) and the card that shows the 8-digit code to
 * enter on the computer. The scanner and the Add machine sheet both use them.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { pairRemote, type PairingCode, type PairingRun } from "../dsh/pair";
import type { PairingTicket } from "../dsh/pairing";
import { t } from "../i18n/index.ts";
import { MONO, SANS, radius, type Palette } from "../theme";
import type { Machine } from "../types";

export interface RemotePairing {
  /** A pairing is under way: resolving the code, or waiting on the computer. */
  busy: boolean;
  /** The code to enter on the computer, once the server issued it. */
  code: PairingCode | null;
  error: string | null;
  start(ticket: PairingTicket): void;
  cancel(): void;
}

export function useRemotePairing(machines: readonly Machine[], onAdd: (machine: Machine) => void): RemotePairing {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<PairingRun | null>(null);
  const machinesRef = useRef(machines);
  machinesRef.current = machines;

  // Leaving the screen ends the pairing, on the computer too.
  useEffect(() => () => run.current?.cancel(), []);

  const start = useCallback(
    (ticket: PairingTicket) => {
      if (run.current !== null) return;
      setBusy(true);
      setError(null);
      setCode(null);
      const current = pairRemote(ticket, machinesRef.current, setCode);
      run.current = current;
      current.machine
        .then((machine) => {
          if (run.current === current) onAdd(machine);
        })
        .catch((cause: unknown) => {
          if (run.current === current) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (run.current !== current) return;
          run.current = null;
          setBusy(false);
          setCode(null);
        });
    },
    [onAdd],
  );

  const cancel = useCallback(() => {
    const current = run.current;
    run.current = null;
    current?.cancel();
    setBusy(false);
    setCode(null);
  }, []);

  return { busy, code, error, start, cancel };
}

/** The computer to approve and the code to type there, with a way out. */
export function RemotePairingCard({ code, c, onCancel }: { code: PairingCode | null; c: Palette; onCancel: () => void }): ReactNode {
  return (
    <View style={[styles.card, { backgroundColor: c.overlay, borderColor: c.borderStrong }]} accessibilityLiveRegion="polite">
      {code === null ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={c.fg} />
          <Text style={[styles.hint, { color: c.fgMuted }]}>{t("dshPair.checking")}</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.title, { color: c.fg }]}>{t("dshPair.enterOn", { host: code.host })}</Text>
          <Text style={[styles.code, { color: c.fg }]} accessibilityLabel={code.code.split("").join(" ")} selectable>
            {`${code.code.slice(0, 4)} ${code.code.slice(4)}`}
          </Text>
          <Text style={[styles.fingerprint, { color: c.fgFaint }]}>{t("dshPair.fingerprint", { fingerprint: code.fingerprint })}</Text>
          <View style={styles.waiting}>
            <ActivityIndicator size="small" color={c.fgMuted} />
            <Text style={[styles.hint, { color: c.fgMuted }]}>{t("dshPair.waiting")}</Text>
          </View>
        </>
      )}
      <Pressable onPress={onCancel} style={[styles.cancel, { backgroundColor: c.raised, borderColor: c.borderStrong }]} accessibilityRole="button">
        <Text style={[styles.cancelText, { color: c.fg }]}>{t("common.cancel")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: "stretch", padding: 16, gap: 12, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: SANS, fontSize: 15, lineHeight: 21, fontWeight: "600", textAlign: "center" },
  code: { fontFamily: MONO, fontSize: 34, lineHeight: 42, letterSpacing: 4, textAlign: "center" },
  fingerprint: { fontFamily: MONO, fontSize: 11, lineHeight: 16, textAlign: "center" },
  waiting: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  hint: { fontFamily: SANS, fontSize: 13, lineHeight: 18 },
  cancel: { height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  cancelText: { fontFamily: SANS, fontSize: 15, fontWeight: "500" },
});
