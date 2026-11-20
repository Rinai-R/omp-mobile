import { StatusBar } from "expo-status-bar";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Appearance,
  AppState,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useSharedValue } from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import appConfig from "./app.json";
import * as Attention from "./modules/omp-attention/src";
import { AttentionBanner } from "./src/components/AttentionBanner";
import { ChatScreen } from "./src/screens/ChatScreen";
import { MachineSwitcher } from "./src/components/MachineSwitcher";
import { ScreenStack, type Layer } from "./src/components/ScreenStack";
import { SessionSwitcher } from "./src/components/SessionSwitcher";
import { TabBar, type Tab } from "./src/components/TabBar";
import { HomeScreen } from "./src/screens/HomeScreen";
import { MachinesScreen, type AddRequest } from "./src/screens/MachinesScreen";
import { PairScanner } from "./src/screens/PairScanner";
import { resolveLanguage, setLanguage, t, type LanguagePreference } from "./src/i18n/index.ts";
import { nativeStrings, systemLocale, useLanguage } from "./src/i18n/native.ts";
import { isPairingLink } from "./src/pairing";
import { SettingsScreen, type LiveState, type NotificationState } from "./src/screens/SettingsScreen";
import { probeMachine, type Probe } from "./src/probe";
import { followRelayEvents } from "./src/relay/attention";
import { forgetRelay } from "./src/relay/hosts";
import { DEFAULT_SETTINGS, loadMachines, loadSettings, saveMachines, saveSettings, type AppearancePreference, type Settings } from "./src/storage";
import { palette } from "./src/theme";
import { dropMachine } from "./src/transcripts";
import type { Machine, SessionSummary } from "./src/types";

/** The shell under every pushed screen. */
type Base =
  /** The computers screen on its own: only while no computer is paired. */
  | { kind: "machines" }
  /** The tabbed shell on `machine`; `create` is a nonce: a new value opens the New session sheet once. */
  | { kind: "home"; machine: Machine; tab: Tab; create?: number };

/** A screen pushed over the shell: it slides in from the right and back goes to the shell. */
type Pushed =
  /** `focus`: the timestamp of a message to open on (a search hit). */
  | { kind: "chat"; machine: Machine; session: SessionSummary; focus?: number }
  /** Settings on their own: only from the computers screen before any computer is paired. */
  | { kind: "settings" }
  | { kind: "scan" };

interface Route {
  base: Base;
  top: Pushed | null;
}

/** `current` with `session`'s chat pushed; the shell under it is that computer's Sessions tab, where back goes. */
function withChat(current: Route, machine: Machine, session: SessionSummary, focus?: number): Route {
  const base: Base =
    current.base.kind === "home" && current.base.machine.id === machine.id && current.base.tab === "sessions"
      ? current.base
      : { kind: "home", machine, tab: "sessions" };
  return { base, top: { kind: "chat", machine, session, focus } };
}

// No top edge: every screen's glass bar runs up under the status bar and pads itself by the inset.
const EDGES = ["left", "right"] as const;

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

/** The scheme React Native is told to use: `unspecified` follows the phone. */
function colorSchemeOf(preference: AppearancePreference): "light" | "dark" | "unspecified" {
  return preference === "system" ? "unspecified" : preference;
}

/** Whether the live activity is a Live Update here: Android 16 QPR1+ promotes it once the user allows it. */
function liveState(): LiveState {
  if (Platform.OS !== "android" || typeof Platform.Version !== "number" || Platform.Version < 36) return "unsupported";
  return Attention.canPromote() ? "on" : "off";
}

/** What the notification service is told to follow: relay machines are followed here and handed over. */
function attentionMachines(machines: readonly Machine[]): Attention.AttentionMachine[] {
  return machines.map((machine) => ({ id: machine.id, name: machine.name, url: machine.url, token: machine.token, relay: machine.relay !== undefined }));
}

/** A session known only by id (a notification tap, so one the daemon runs): the chat's snapshot fills in the rest. */
function placeholderSession(machine: Machine, sessionId: string, title: string): SessionSummary {
  return { id: sessionId, title: title || t("common.session"), cwd: machine.cwd, status: "idle", createdAt: 0, updatedAt: 0, origin: "daemon" };
}

export default function App(): ReactNode {
  const scheme = useColorScheme();
  const language = useLanguage();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [route, setRoute] = useState<Route>({ base: { kind: "machines" }, top: null });
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
  const [live, setLive] = useState<LiveState>("unsupported");
  /** A frame for a session not on screen, while the app is open. */
  const [banner, setBanner] = useState<Attention.Attention | null>(null);
  /** A notification tap that arrived before the stored machines were restored. */
  const [pendingOpen, setPendingOpen] = useState<Attention.OpenSession | null>(null);
  /** Sessions waiting for an answer on the computer on screen, for the Sessions tab's badge. */
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    void Promise.all([loadMachines(), loadSettings()]).then(([stored, storedSettings]) => {
      machinesRef.current = stored;
      setMachines(stored);
      setSettings(storedSettings);
      setLanguage(resolveLanguage(storedSettings.language, systemLocale()));
      Appearance.setColorScheme(colorSchemeOf(storedSettings.appearance));
      // The app opens on the computer used last; with none paired, on the computers screen.
      const last = stored.find((item) => item.id === storedSettings.lastMachineId) ?? stored[0];
      if (last !== undefined) setRoute({ base: { kind: "home", machine: last, tab: "sessions" }, top: null });
      // The service follows these machines while the setting is on; it persists both for the boot receiver.
      Attention.setMachines(attentionMachines(stored));
      const state = notificationState(storedSettings.notifications);
      Attention.setEnabled(state === "on");
      setNotifications(state);
      setBatteryRestricted(Attention.isBatteryRestricted());
      setLive(liveState());
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

  // Relay machines' events, followed here while notifications are on (the service keeps the app alive).
  const relayIds = machines
    .filter((machine) => machine.relay !== undefined)
    .map((machine) => machine.id)
    .join("\n");
  useEffect(() => {
    if (notifications !== "on" || relayIds === "") return undefined;
    return followRelayEvents(machinesRef.current.filter((machine) => machine.relay !== undefined));
  }, [notifications, relayIds]);

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
    // The Computers tab of the computer used last, or the computers screen on its own while none is paired.
    const list = machinesRef.current;
    const last = list.find((item) => item.id === settingsRef.current.lastMachineId) ?? list[0];
    setRoute({ base: last === undefined ? { kind: "machines" } : { kind: "home", machine: last, tab: "computers" }, top: null });
  }, [pendingLink, restored]);

  // Once restored, a tap opens that session's chat.
  useEffect(() => {
    if (!restored || pendingOpen === null) return;
    setPendingOpen(null);
    const machine = machinesRef.current.find((item) => item.id === pendingOpen.machineId);
    if (machine === undefined) return;
    setBanner(null);
    setRoute((current) =>
      current.top?.kind === "chat" && current.top.machine.id === machine.id && current.top.session.id === pendingOpen.sessionId
        ? current
        : withChat(current, machine, placeholderSession(machine, pendingOpen.sessionId, "")),
    );
  }, [pendingOpen, restored]);

  // Back in the foreground: the user may have changed the permission or battery setting meanwhile.
  useEffect(() => {
    if (!restored) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNotifications(notificationState(settings.notifications));
      setBatteryRestricted(Attention.isBatteryRestricted());
      setLive(liveState());
    });
    return () => subscription.remove();
  }, [restored, settings.notifications]);

  const clearAddRequest = useCallback(() => setAddRequest(null), []);
  const openScanner = useCallback(() => setRoute((current) => ({ ...current, top: { kind: "scan" } })), []);
  /** Back to the shell under the pushed screen (the scanner's or the settings' computers screen). */
  const popToBase = useCallback(() => setRoute((current) => ({ ...current, top: null })), []);
  const scannerToManual = useCallback(() => {
    setAddRequest({ nonce: Date.now(), link: null });
    popToBase();
  }, [popToBase]);

  const persist = useCallback((next: Machine[]) => {
    const before = machinesRef.current;
    machinesRef.current = next;
    setMachines(next);
    void saveMachines(next);
    // Only what the service reads: a probe's lastSeen does not restart the streams.
    const followed = (list: Machine[]) => list.map((item) => `${item.id}\n${item.url}\n${item.token}\n${item.name}`).join("\n\n");
    if (followed(before) !== followed(next)) Attention.setMachines(attentionMachines(next));
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
      setRoute({ base: { kind: "home", machine, tab: "sessions", create: create === true ? Date.now() : undefined }, top: null });
      setSettings((current) => {
        if (current.lastMachineId === machine.id) return current;
        const next = { ...current, lastMachineId: machine.id };
        void saveSettings(next);
        return next;
      });
    },
    [],
  );
  /** Pop the pushed screen; a chat's home is remembered as the computer to open on. */
  const popScreen = useCallback(() => {
    if (route.top?.kind === "chat") goHome(route.top.machine);
    else popToBase();
  }, [goHome, popToBase, route.top]);
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.top !== null) {
        popScreen();
        return true;
      }
      // Back from another tab is the Sessions tab, as on a tabbed app; from Sessions, or the computers screen, it leaves.
      const base = route.base;
      if (base.kind !== "home" || base.tab === "sessions") return false;
      setRoute({ base: { ...base, tab: "sessions", create: undefined }, top: null });
      return true;
    });
    return () => subscription.remove();
  }, [popScreen, route]);

  const [switcher, setSwitcher] = useState<{ machine: Machine; sessionId?: string; search?: boolean } | null>(null);
  const [machinePicker, setMachinePicker] = useState(false);
  const openChat = useCallback((machine: Machine, session: SessionSummary, focus?: number) => {
    setSwitcher(null);
    setRoute((current) =>
      current.top?.kind === "chat" && current.top.machine.id === machine.id && current.top.session.id === session.id && focus === undefined
        ? current
        : withChat(current, machine, session, focus),
    );
  }, []);

  // Probe while the machines screen is shown: now, every 15 s, and on return to the foreground.
  // Keyed by the machine ids, so a new machine is probed at once but saving lastSeen does not re-probe.
  const onMachines = restored && route.top === null;
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
      // Through a relay the pairing itself ends too: the computer stops listing this phone.
      if (machine.relay !== undefined) void forgetRelay(machine.relay, machinesRef.current).catch(() => undefined);
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

  /** Switch the language now: the whole tree re-renders under the new one, no restart. */
  const chooseLanguage = useCallback(
    (preference: LanguagePreference) => {
      setLanguage(resolveLanguage(preference, systemLocale()));
      updateSettings({ ...settingsRef.current, language: preference });
    },
    [updateSettings],
  );

  /** Switch light/dark now: every screen re-renders under the new palette. */
  const chooseAppearance = useCallback(
    (preference: AppearancePreference) => {
      Appearance.setColorScheme(colorSchemeOf(preference));
      updateSettings({ ...settingsRef.current, appearance: preference });
    },
    [updateSettings],
  );

  // The notification service composes its text natively: hand it the app's language.
  useEffect(() => {
    if (restored) Attention.setStrings(nativeStrings(language));
  }, [language, restored]);
  // Removing the computer on screen leaves its home and its chat: go to another, or to the computers screen.
  useEffect(() => {
    const { base, top } = route;
    const baseGone = base.kind === "home" && !machines.some((item) => item.id === base.machine.id);
    const chatGone = top?.kind === "chat" && !machines.some((item) => item.id === top.machine.id);
    if (!baseGone && !chatGone) return;
    const first = machines[0];
    const tab = base.kind === "home" ? base.tab : "sessions";
    setRoute({
      base: !baseGone ? base : first === undefined ? { kind: "machines" } : { kind: "home", machine: first, tab },
      top: chatGone ? null : top,
    });
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

  // How much of each tab's page runs on under the tab bar: its hairline while that tab is current.
  const tabUnder = { sessions: useSharedValue(0), computers: useSharedValue(0), settings: useSharedValue(0) };

  const fixBattery = useCallback(() => Attention.requestBatteryExemption(), []);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const openBanner = useCallback((attention: Attention.Attention) => {
    setBanner(null);
    const machine = machinesRef.current.find((item) => item.id === attention.machineId);
    if (machine === undefined) return;
    setRoute((current) => withChat(current, machine, placeholderSession(machine, attention.sessionId, attention.sessionTitle)));
  }, []);

  /** The stored machine a route names: routes keep a copy, and a rename or probe updates the stored one. */
  const liveMachine = (machine: Machine): Machine => machines.find((item) => item.id === machine.id) ?? machine;
  function settingsScreen(onBack?: () => void): ReactNode {
    return (
      <SettingsScreen
        notifications={notifications}
        language={settings.language}
        onLanguage={chooseLanguage}
        appearance={settings.appearance}
        onAppearance={chooseAppearance}
        batteryRestricted={batteryRestricted}
        onToggleNotifications={toggleNotifications}
        onOpenNotificationSettings={Attention.openNotificationSettings}
        onFixBattery={fixBattery}
        live={live}
        onAllowLive={() => void Attention.openPromotionSettings()}
        onBack={onBack}
        under={onBack === undefined ? tabUnder.settings : undefined}
        version={appConfig.expo.version}
      />
    );
  }
  function machinesScreen(tabbed: boolean): ReactNode {
    return (
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
        onSettings={() => setRoute((current) => ({ ...current, top: { kind: "settings" } }))}
        tabbed={tabbed}
        under={tabbed ? tabUnder.computers : undefined}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void probeAll().finally(() => setRefreshing(false));
        }}
      />
    );
  }
  const background = palette(scheme).bg;
  let base: ReactNode;
  if (!restored) {
    base = (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={palette(scheme).fgMuted} />
      </View>
    );
  } else if (route.base.kind === "home") {
    const home = route.base;
    const tab = home.tab;
    base = (
      <View style={{ flex: 1 }}>
        {/* Kept mounted under the other tabs: its search, scroll and list survive a tab switch. */}
        <View style={tab === "sessions" ? { flex: 1 } : { display: "none" }}>
          <HomeScreen
            // Another computer's home starts fresh: its list and probe state.
            key={home.machine.id}
            machine={liveMachine(home.machine)}
            machines={machines}
            probe={probes.get(home.machine.id)}
            onOpen={openChat}
            onPickMachine={() => setMachinePicker(true)}
            onWaiting={setWaiting}
            onRetry={(machine) => void probeOne(machine)}
            newRequest={home.create ?? 0}
            // Under a pushed chat it stays mounted; coming back to it refreshes the list quietly.
            active={route.top === null && tab === "sessions"}
            under={tabUnder.sessions}
          />
        </View>
        {tab === "computers" ? machinesScreen(true) : tab === "settings" ? settingsScreen() : null}
        {/* Tabs switch in place: no motion between peers. */}
        <TabBar
          current={tab}
          badge={waiting}
          onSelect={(next) => setRoute({ base: { ...home, tab: next, create: undefined }, top: null })}
          under={tabUnder[tab]}
        />
      </View>
    );
  } else {
    base = machinesScreen(false);
  }

  const top = route.top;
  let pushed: Layer | null = null;
  if (top?.kind === "chat") {
    pushed = {
      // Another chat replaces this one in place and starts fresh.
      key: `chat\n${top.machine.id}\n${top.session.id}`,
      node: (
        <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={EDGES}>
          <ChatScreen
            machine={liveMachine(top.machine)}
            session={top.session}
            focus={top.focus}
            onBack={popScreen}
            onSwitch={() => setSwitcher({ machine: top.machine, sessionId: top.session.id })}
            onOpenSession={openChat}
          />
        </SafeAreaView>
      ),
    };
  } else if (top?.kind === "settings") {
    pushed = {
      key: "settings",
      node: (
        <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={EDGES}>
          {settingsScreen(popScreen)}
        </SafeAreaView>
      ),
    };
  } else if (top?.kind === "scan") {
    pushed = {
      key: "scan",
      // The camera runs edge to edge; the scanner pads its own bars by the safe area.
      node: (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <PairScanner machines={machines} onAdd={addMachine} onClose={popScreen} onManual={scannerToManual} />
        </View>
      ),
    };
  }

  const homeMachine = route.base.kind === "home" ? liveMachine(route.base.machine) : undefined;
  // The system font size changed (the activity is kept for it, see plugins/withFontScaleChanges.js):
  // the screens render again so their text is measured at the new size; the route stays.
  const { fontScale } = useWindowDimensions();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <KeyboardProvider>
    <SafeAreaProvider>
      {/* Keyed by the language and the font size: every screen and sheet renders again in the new one. */}
      <Fragment key={`${language}\n${fontScale}`}>
        <StatusBar style={top?.kind === "scan" || palette(scheme).dark ? "light" : "dark"} />
        <ScreenStack
          base={
            <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={EDGES}>
              {base}
            </SafeAreaView>
          }
          top={pushed}
          onSwipeBack={popScreen}
        />
        {banner !== null && top?.kind !== "scan" ? (
          <AttentionBanner attention={banner} onOpen={openBanner} onDismiss={dismissBanner} />
        ) : null}
        <SessionSwitcher
          visible={switcher !== null}
          machines={machines}
          probes={probes}
          machine={switcher?.machine}
          currentSessionId={switcher?.sessionId}
          search={switcher?.search === true}
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
            onManage={() => setRoute({ base: { kind: "home", machine: homeMachine, tab: "computers" }, top: null })}
          />
        ) : null}
      </Fragment>
    </SafeAreaProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
