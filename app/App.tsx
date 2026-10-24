import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import appConfig from "./app.json";
import * as Attention from "./modules/omp-attention/src";
import { AttentionBanner } from "./src/components/AttentionBanner";
import { ChatScreen } from "./src/screens/ChatScreen";
import { MachineSwitcher } from "./src/components/MachineSwitcher";
import { SessionSwitcher } from "./src/components/SessionSwitcher";
import { HomeScreen } from "./src/screens/HomeScreen";
import { MachinesScreen, type AddRequest } from "./src/screens/MachinesScreen";
import { PairScanner } from "./src/screens/PairScanner";
import { isPairingLink } from "./src/pairing";
import { SettingsScreen, type NotificationState } from "./src/screens/SettingsScreen";
import { probeMachine, type Probe } from "./src/probe";
import { DEFAULT_SETTINGS, loadMachines, loadSettings, saveMachines, saveSettings, type Settings } from "./src/storage";
import { palette } from "./src/theme";
import { dropMachine } from "./src/transcripts";
import type { Machine, SessionSummary } from "./src/types";

type Route =
  | { kind: "machines" }
  /** `create` is a nonce: a new value opens the New session sheet once. */
  | { kind: "home"; machine: Machine; create?: number }
  | { kind: "chat"; machine: Machine; session: SessionSummary }
  | { kind: "settings"; from: Machine | null }
  | { kind: "scan" };

const EDGES = ["top", "left", "right"] as const;

/** How often the machines screen probes every machine while it is shown. */
const PROBE_INTERVAL_MS = 15_000;

/** Ask for POST_NOTIFICATIONS where Android has it (13+); true when the app may post. */
async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (typeof Platform.Version === "number" && Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
  }
  // The permission is not the whole answer: the user may have switched the app's notifications off.
  return Attention.notificationsAllowed();
}

/** What the Notifications switch shows for the stored setting and what the system allows now. */
function notificationState(enabled: boolean): NotificationState {
  if (!Attention.isSupported()) return "unsupported";
  if (!enabled) return "off";
  return Attention.notificationsAllowed() ? "on" : "denied";
}

/** A session known only by id (a notification tap, so one the daemon runs): the chat's snapshot fills in the rest. */
function placeholderSession(machine: Machine, sessionId: string, title: string): SessionSummary {
  return { id: sessionId, title: title || "Session", cwd: machine.cwd, status: "idle", createdAt: 0, updatedAt: 0, origin: "daemon" };
}

export default function App(): ReactNode {
  const scheme = useColorScheme();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [route, setRoute] = useState<Route>({ kind: "machines" });
  const [restored, setRestored] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The latest probe of each machine by id, in memory only. */
  const [probes, setProbes] = useState<ReadonlyMap<string, Probe>>(new Map());
  /** The stored machines as of now, for probes that finish after a render. */
  const machinesRef = useRef<Machine[]>([]);
  /** The probe in flight per machine, so rounds do not pile up on a slow link. */
  const inFlight = useRef(new Map<string, Promise<void>>());
  /** Open the Add machine sheet on the machines screen, maybe pre-filled from a pairing link. */
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  /** A pairing link that arrived before the stored machines were restored. */
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationState>("off");
  const [batteryRestricted, setBatteryRestricted] = useState(false);
  /** A frame for a session not on screen, while the app is open. */
  const [banner, setBanner] = useState<Attention.Attention | null>(null);
  /** A notification tap that arrived before the stored machines were restored. */
  const [pendingOpen, setPendingOpen] = useState<Attention.OpenSession | null>(null);

  useEffect(() => {
    void Promise.all([loadMachines(), loadSettings()]).then(([stored, storedSettings]) => {
      machinesRef.current = stored;
      setMachines(stored);
      setSettings(storedSettings);
      // The app opens on the computer used last; with none paired, on the computers screen.
      const last = stored.find((item) => item.id === storedSettings.lastMachineId) ?? stored[0];
      if (last !== undefined) setRoute({ kind: "home", machine: last });
      // The service follows these machines while the setting is on; it persists both for the boot receiver.
      Attention.setMachines(stored);
      const state = notificationState(storedSettings.notifications);
      Attention.setEnabled(state === "on");
      setNotifications(state);
      setBatteryRestricted(Attention.isBatteryRestricted());
      setRestored(true);
      // A tap that launched the app before any listener existed.
      setPendingOpen(Attention.takePendingOpen());
    });
  }, []);

  // Notification taps while the app runs, and in-app banners for sessions not on screen.
  useEffect(() => {
    const offOpen = Attention.onOpenSession((open) => setPendingOpen(open));
    const offAttention = Attention.onAttention((attention) => {
      setBanner((visible) => {
        if (attention.kind === "resolved") {
          return visible !== null && visible.key === attention.key && visible.sessionId === attention.sessionId
            ? null
            : visible;
        }
        return attention;
      });
    });
    return () => {
      offOpen();
      offAttention();
    };
  }, []);

  // `omp-mobile://pair?...` links, whether they launched the app or arrived while it ran.
  useEffect(() => {
    const take = (url: string | null) => {
      if (url !== null && isPairingLink(url)) setPendingLink(url);
    };
    void Linking.getInitialURL()
      .then(take)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => take(url));
    return () => subscription.remove();
  }, []);

  // Once restored, a link opens the Add machine sheet pre-filled; Connect is the one confirmation.
  useEffect(() => {
    if (!restored || pendingLink === null) return;
    setPendingLink(null);
    setAddRequest((current) => ({ nonce: (current?.nonce ?? 0) + 1, link: pendingLink }));
    setRoute({ kind: "machines" });
  }, [pendingLink, restored]);

  // Once restored, a tap opens that session's chat.
  useEffect(() => {
    if (!restored || pendingOpen === null) return;
    setPendingOpen(null);
    const machine = machinesRef.current.find((item) => item.id === pendingOpen.machineId);
    if (machine === undefined) return;
    setBanner(null);
    setRoute((current) =>
      current.kind === "chat" && current.machine.id === machine.id && current.session.id === pendingOpen.sessionId
        ? current
        : { kind: "chat", machine, session: placeholderSession(machine, pendingOpen.sessionId, "") },
    );
  }, [pendingOpen, restored]);

  // Back in the foreground: the user may have changed the permission or battery setting meanwhile.
  useEffect(() => {
    if (!restored) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNotifications(notificationState(settings.notifications));
      setBatteryRestricted(Attention.isBatteryRestricted());
    });
    return () => subscription.remove();
  }, [restored, settings.notifications]);

  const clearAddRequest = useCallback(() => setAddRequest(null), []);
  const openScanner = useCallback(() => setRoute({ kind: "scan" }), []);
  const closeScanner = useCallback(() => setRoute({ kind: "machines" }), []);
  const scannerToManual = useCallback(() => {
    setAddRequest({ nonce: Date.now(), link: null });
    setRoute({ kind: "machines" });
  }, []);

  /** Where back goes from `current`; null leaves the app (the home, or the computers screen with none paired). */
  const backOf = useCallback((current: Route): Route | null => {
    switch (current.kind) {
      case "chat":
        return { kind: "home", machine: current.machine };
      case "settings":
        return current.from !== null ? { kind: "home", machine: current.from } : { kind: "machines" };
      case "scan":
        return { kind: "machines" };
      case "machines": {
        const list = machinesRef.current;
        const last = list.find((item) => item.id === settingsRef.current.lastMachineId) ?? list[0];
        return last === undefined ? null : { kind: "home", machine: last };
      }
      default:
        return null;
    }
  }, []);

  const persist = useCallback((next: Machine[]) => {
    const before = machinesRef.current;
    machinesRef.current = next;
    setMachines(next);
    void saveMachines(next);
    // Only what the service reads: a probe's lastSeen does not restart the streams.
    const followed = (list: Machine[]) => list.map((item) => `${item.id}\n${item.url}\n${item.token}\n${item.name}`).join("\n\n");
    if (followed(before) !== followed(next)) Attention.setMachines(next);
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
  const probeAllNow = useCallback(() => void probeAll(), [probeAll]);
  /** The home of `machine`, remembered as the computer to open on next time. */
  const goHome = useCallback(
    (machine: Machine, create?: boolean) => {
      setRoute({ kind: "home", machine, create: create === true ? Date.now() : undefined });
      setSettings((current) => {
        if (current.lastMachineId === machine.id) return current;
        const next = { ...current, lastMachineId: machine.id };
        void saveSettings(next);
        return next;
      });
    },
    [],
  );
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const next = backOf(route);
      if (next === null) return false;
      // Home is remembered as the computer to open on, as the on-screen back buttons do.
      if (next.kind === "home") goHome(next.machine);
      else setRoute(next);
      return true;
    });
    return () => subscription.remove();
  }, [backOf, goHome, route]);

  const [switcher, setSwitcher] = useState<{ machine: Machine; sessionId?: string } | null>(null);
  const [machinePicker, setMachinePicker] = useState(false);
  const openChat = useCallback((machine: Machine, session: SessionSummary) => {
    setSwitcher(null);
    setRoute((current) =>
      current.kind === "chat" && current.machine.id === machine.id && current.session.id === session.id
        ? current
        : { kind: "chat", machine, session },
    );
  }, []);

  // Probe while the machines screen is shown: now, every 15 s, and on return to the foreground.
  // Keyed by the machine ids, so a new machine is probed at once but saving lastSeen does not re-probe.
  const onMachines = restored && (route.kind === "machines" || route.kind === "home");
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
      goHome(machine);
    },
    [goHome, persist],
  );

  const removeMachine = useCallback(
    (machine: Machine) => {
      persist(machinesRef.current.filter((item) => item.id !== machine.id));
      dropMachine(machine.id);
      setProbes((current) => {
        const next = new Map(current);
        next.delete(machine.id);
        return next;
      });
    },
    [persist],
  );

  const renameMachine = useCallback(
    (machine: Machine, label: string | undefined) => {
      persist(machinesRef.current.map((item) => (item.id === machine.id ? { ...item, label } : item)));
    },
    [persist],
  );

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);
  // Removing the computer on screen leaves its home: go to another, or to the computers screen.
  useEffect(() => {
    if (route.kind !== "home" && route.kind !== "chat") return;
    if (machines.some((item) => item.id === route.machine.id)) return;
    const first = machines[0];
    setRoute(first === undefined ? { kind: "machines" } : { kind: "home", machine: first });
  }, [machines, route]);

  const toggleNotifications = useCallback(
    (on: boolean) => {
      if (!on) {
        Attention.setEnabled(false);
        setNotifications("off");
        updateSettings({ ...settings, notifications: false });
        return;
      }
      void requestNotificationPermission().then((allowed) => {
        updateSettings({ ...settings, notifications: allowed });
        Attention.setEnabled(allowed);
        setNotifications(allowed ? "on" : "denied");
        setBatteryRestricted(Attention.isBatteryRestricted());
      });
    },
    [settings, updateSettings],
  );

  const fixBattery = useCallback(() => Attention.requestBatteryExemption(), []);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const openBanner = useCallback((attention: Attention.Attention) => {
    setBanner(null);
    const machine = machinesRef.current.find((item) => item.id === attention.machineId);
    if (machine === undefined) return;
    setRoute({ kind: "chat", machine, session: placeholderSession(machine, attention.sessionId, attention.sessionTitle) });
  }, []);

  /** The stored machine a route names: routes keep a copy, and a rename or probe updates the stored one. */
  const liveMachine = (machine: Machine): Machine => machines.find((item) => item.id === machine.id) ?? machine;
  let content: ReactNode;
  if (!restored) {
    content = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={palette(scheme).fgMuted} />
      </View>
    );
  } else if (route.kind === "chat") {
    content = (
      <ChatScreen
        key={`${route.machine.id}\n${route.session.id}`}
        machine={liveMachine(route.machine)}
        session={route.session}
        onBack={() => goHome(route.machine)}
        onSwitch={() => setSwitcher({ machine: route.machine, sessionId: route.session.id })}
      />
    );
  } else if (route.kind === "home") {
    content = (
      <HomeScreen
        // Another computer's home starts fresh: its list and probe state.
        key={route.machine.id}
        machine={liveMachine(route.machine)}
        probe={probes.get(route.machine.id)}
        onOpen={openChat}
        onPickMachine={() => setMachinePicker(true)}
        onSettings={() => setRoute({ kind: "settings", from: route.machine })}
        onRetry={(machine) => void probeOne(machine)}
        newRequest={route.create ?? 0}
      />
    );
  } else if (route.kind === "scan") {
    content = (
      <PairScanner machines={machines} onAdd={addMachine} onClose={closeScanner} onManual={scannerToManual} />
    );
  } else if (route.kind === "settings") {
    const from = route.from;
    content = (
      <SettingsScreen
        notifications={notifications}
        batteryRestricted={batteryRestricted}
        onToggleNotifications={toggleNotifications}
        onOpenNotificationSettings={Attention.openNotificationSettings}
        onFixBattery={fixBattery}
        onBack={() => setRoute(from !== null ? { kind: "home", machine: from } : { kind: "machines" })}
        version={appConfig.expo.version}
      />
    );
  } else {
    content = (
      <MachinesScreen
        machines={machines}
        probes={probes}
        onAdd={addMachine}
        onScan={openScanner}
        addRequest={addRequest}
        onAddRequestHandled={clearAddRequest}
        onOpen={(machine) => goHome(machine)}
        onRemove={removeMachine}
        onRename={renameMachine}
        onSettings={() => setRoute({ kind: "settings", from: null })}
        onBack={machines[0] === undefined ? undefined : () => goHome(machinesRef.current.find((item) => item.id === settings.lastMachineId) ?? machines[0] as Machine)}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void probeAll().finally(() => setRefreshing(false));
        }}
      />
    );
  }

  const homeMachine = route.kind === "home" || route.kind === "chat" ? liveMachine(route.machine) : undefined;

  return (
    <SafeAreaProvider>
      <StatusBar style={route.kind === "scan" || palette(scheme).dark ? "light" : "dark"} />
      {route.kind === "scan" ? (
        // The camera runs edge to edge; the scanner pads its own bars by the safe area.
        content
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: palette(scheme).bg }} edges={EDGES}>
          {content}
        </SafeAreaView>
      )}
      {banner !== null && route.kind !== "scan" ? (
        <AttentionBanner attention={banner} onOpen={openBanner} onDismiss={dismissBanner} />
      ) : null}
      <SessionSwitcher
        visible={switcher !== null}
        machines={machines}
        probes={probes}
        machine={switcher?.machine}
        currentSessionId={switcher?.sessionId}
        onPick={openChat}
        onNew={(machine) => {
          setSwitcher(null);
          goHome(machine, true);
        }}
        onClose={() => setSwitcher(null)}
      />
      {homeMachine !== undefined ? (
        <MachineSwitcher
          visible={machinePicker}
          machines={machines}
          current={homeMachine}
          probes={probes}
          onProbe={probeAllNow}
          onPick={(machine) => goHome(machine)}
          onClose={() => setMachinePicker(false)}
          onManage={() => setRoute({ kind: "machines" })}
        />
      ) : null}
    </SafeAreaProvider>
  );
}
