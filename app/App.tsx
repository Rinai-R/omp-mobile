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
import { MachinesScreen, type AddRequest } from "./src/screens/MachinesScreen";
import { PairScanner } from "./src/screens/PairScanner";
import { isPairingLink } from "./src/pairing";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { SettingsScreen, type NotificationState } from "./src/screens/SettingsScreen";
import { probeMachine, type Probe } from "./src/probe";
import { DEFAULT_SETTINGS, loadMachines, loadSettings, saveMachines, saveSettings, type Settings } from "./src/storage";
import { palette } from "./src/theme";
import { dropMachine } from "./src/transcripts";
import type { Machine, SessionSummary } from "./src/types";

type Route =
  | { kind: "machines" }
  | { kind: "sessions"; machine: Machine }
  | { kind: "chat"; machine: Machine; session: SessionSummary }
  | { kind: "settings" }
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
  const switchMachine = useCallback((machine: Machine) => setRoute({ kind: "sessions", machine }), []);

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
      dropMachine(machine.id);
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
        machine={route.machine}
        session={route.session}
        onBack={() => setRoute({ kind: "sessions", machine: route.machine })}
        onSwitch={() => setRoute({ kind: "sessions", machine: route.machine })}
      />
    );
  } else if (route.kind === "sessions") {
    content = (
      <SessionsScreen
        // A switch is a different machine's screen: its list and probe state start fresh.
        key={route.machine.id}
        machine={route.machine}
        probe={probes.get(route.machine.id)}
        onRetry={(machine) => void probeOne(machine)}
        onBack={() => setRoute({ kind: "machines" })}
        onOpen={(machine, session) => setRoute({ kind: "chat", machine, session })}
        machines={machines}
        probes={probes}
        onProbeAll={probeAllNow}
        onSwitch={switchMachine}
      />
    );
  } else if (route.kind === "scan") {
    content = (
      <PairScanner machines={machines} onAdd={addMachine} onClose={closeScanner} onManual={scannerToManual} />
    );
  } else if (route.kind === "settings") {
    content = (
      <SettingsScreen
        notifications={notifications}
        batteryRestricted={batteryRestricted}
        onToggleNotifications={toggleNotifications}
        onOpenNotificationSettings={Attention.openNotificationSettings}
        onFixBattery={fixBattery}
        onBack={() => setRoute({ kind: "machines" })}
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
    </SafeAreaProvider>
  );
}
