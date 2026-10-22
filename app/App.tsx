import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, BackHandler, Platform, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ChatScreen } from "./src/screens/ChatScreen";
import { MachinesScreen } from "./src/screens/MachinesScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { probeMachine, type Probe } from "./src/probe";
import { DEFAULT_SETTINGS, loadMachines, loadSettings, saveMachines, saveSettings, type Settings } from "./src/storage";
import { palette } from "./src/theme";
import type { Machine, SessionSummary } from "./src/types";

type Route =
  | { kind: "machines" }
  | { kind: "sessions"; machine: Machine }
  | { kind: "chat"; machine: Machine; session: SessionSummary }
  | { kind: "settings" };

const EDGES = ["top", "left", "right"] as const;

/** How often the machines screen probes every machine while it is shown. */
const PROBE_INTERVAL_MS = 15_000;

export default function App(): ReactNode {
  const scheme = useColorScheme();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>({ kind: "machines" });
  const [restored, setRestored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The latest probe of each machine by id, in memory only. */
  const [probes, setProbes] = useState<ReadonlyMap<string, Probe>>(new Map());
  /** The stored machines as of now, for probes that finish after a render. */
  const machinesRef = useRef<Machine[]>([]);
  /** The probe in flight per machine, so rounds do not pile up on a slow link. */
  const inFlight = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    void Promise.all([loadMachines(), loadSettings()]).then(([stored, storedSettings]) => {
      machinesRef.current = stored;
      setMachines(stored);
      setSettings(storedSettings);
      setRestored(true);
    });
  }, []);

  const back = useCallback(() => {
    setRoute((current) => {
      if (current.kind === "chat") return { kind: "sessions", machine: current.machine };
      return { kind: "machines" };
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.kind === "machines") return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, route.kind]);

  const persist = useCallback((next: Machine[]) => {
    machinesRef.current = next;
    setMachines(next);
    void saveMachines(next);
  }, []);

  const probeOne = useCallback(
    (machine: Machine): Promise<void> => {
      const pending = inFlight.current.get(machine.id);
      if (pending !== undefined) return pending;
      const run = probeMachine(machine)
        .then((probe) => {
          // A machine removed while it was probed has no row to update.
          if (!machinesRef.current.some((item) => item.id === machine.id)) return;
          setProbes((current) => new Map(current).set(machine.id, probe));
          if (probe.state === "online") {
            const seen = Date.now();
            persist(machinesRef.current.map((item) => (item.id === machine.id ? { ...item, lastSeen: seen } : item)));
          }
        })
        .finally(() => inFlight.current.delete(machine.id));
      inFlight.current.set(machine.id, run);
      return run;
    },
    [persist],
  );

  const probeAll = useCallback(
    () => Promise.all(machinesRef.current.map((machine) => probeOne(machine))).then(() => undefined),
    [probeOne],
  );

  // Probe while the machines screen is shown: now, every 15 s, and on return to the foreground.
  // Keyed by the machine ids, so a new machine is probed at once but saving lastSeen does not re-probe.
  const onMachines = restored && route.kind === "machines";
  const machineIds = machines.map((machine) => machine.id).join("\n");
  useEffect(() => {
    if (!onMachines) return undefined;
    void probeAll();
    const timer = setInterval(() => void probeAll(), PROBE_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void probeAll();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [machineIds, onMachines, probeAll]);

  const addMachine = useCallback(
    (machine: Machine) => {
      persist([...machinesRef.current.filter((item) => item.url !== machine.url), machine]);
      setRoute({ kind: "sessions", machine });
    },
    [persist],
  );

  const removeMachine = useCallback(
    (machine: Machine) => {
      persist(machinesRef.current.filter((item) => item.id !== machine.id));
      setProbes((current) => {
        const next = new Map(current);
        next.delete(machine.id);
        return next;
      });
    },
    [persist],
  );

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  let content: ReactNode;
  if (!restored) {
    content = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={palette(scheme).textSecondary} />
      </View>
    );
  } else if (route.kind === "chat") {
    content = (
      <ChatScreen
        machine={route.machine}
        session={route.session}
        onBack={() => setRoute({ kind: "sessions", machine: route.machine })}
      />
    );
  } else if (route.kind === "sessions") {
    content = (
      <SessionsScreen
        machine={route.machine}
        probe={probes.get(route.machine.id)}
        onRetry={(machine) => void probeOne(machine)}
        onBack={() => setRoute({ kind: "machines" })}
        onOpen={(machine, session) => setRoute({ kind: "chat", machine, session })}
      />
    );
  } else if (route.kind === "settings") {
    content = (
      <SettingsScreen
        settings={settings}
        onChange={updateSettings}
        onBack={() => setRoute({ kind: "machines" })}
        version="0.1.0"
      />
    );
  } else {
    content = (
      <MachinesScreen
        machines={machines}
        probes={probes}
        onAdd={addMachine}
        onOpen={(machine) => setRoute({ kind: "sessions", machine })}
        onRemove={removeMachine}
        onSettings={() => setRoute({ kind: "settings" })}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void probeAll().finally(() => setRefreshing(false));
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1, backgroundColor: palette(scheme).bg }} edges={EDGES}>
        {content}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
