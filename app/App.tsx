import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BackHandler, Platform, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ChatScreen } from "./src/screens/ChatScreen";
import { MachinesScreen } from "./src/screens/MachinesScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { DEFAULT_SETTINGS, loadMachines, loadSettings, saveMachines, saveSettings, type Settings } from "./src/storage";
import { palette } from "./src/theme";
import type { Machine, SessionSummary } from "./src/types";

type Route =
  | { kind: "machines" }
  | { kind: "sessions"; machine: Machine }
  | { kind: "chat"; machine: Machine; session: SessionSummary }
  | { kind: "settings" };

const EDGES = ["top", "left", "right"] as const;

export default function App(): ReactNode {
  const scheme = useColorScheme();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>({ kind: "machines" });
  const [restored, setRestored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void Promise.all([loadMachines(), loadSettings()]).then(([stored, storedSettings]) => {
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
    setMachines(next);
    void saveMachines(next);
  }, []);

  const addMachine = useCallback(
    (machine: Machine) => {
      persist([...machines.filter((item) => item.url !== machine.url), machine]);
      setRoute({ kind: "sessions", machine });
    },
    [machines, persist],
  );

  const removeMachine = useCallback(
    (machine: Machine) => {
      persist(machines.filter((item) => item.id !== machine.id));
    },
    [machines, persist],
  );

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  let content: ReactNode;
  if (!restored) {
    content = null;
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
        onAdd={addMachine}
        onOpen={(machine) => setRoute({ kind: "sessions", machine })}
        onRemove={removeMachine}
        onSettings={() => setRoute({ kind: "settings" })}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          setTimeout(() => setRefreshing(false), 350);
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
