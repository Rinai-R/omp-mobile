import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { pairMachine } from "../api";
import { getLanguage, t } from "../i18n/index.ts";
import { displayName } from "../machines";
import { isPairingLink, normalizeUrl, pairingMessage, readPairing } from "../pairing";
import {
  DEFAULT_RELAY,
  hostRegistrationCode,
  joinCommands,
  oauthProviders,
  oauthResult,
  preferredFirst,
  relayUrl,
  signInNeeded,
  startOAuth,
  unsupported,
  type OAuthProvider,
  type OAuthSession,
} from "../relay/account";
import { saveAccountToken, savedAccountRelays, savedAccountToken } from "../relay/hosts";
import { loginRelay, loginRelayWithToken, pickRelay, resumeRelay, waitForNewComputer, type RelayLoginResult } from "../relay/pair";
import { parsePairingTicket } from "../relay/pairing";
import { RemoteServerError } from "../relay/server";
import { MONO, SANS, radius, useColors, useStyles, type Palette } from "../theme";
import type { Machine } from "../types";
import { Spinner } from "./brand";
import { BackGlyph, CheckGlyph, ChevronGlyph, ComputerGlyph, CopyGlyph, GlobeGlyph, QrGlyph, TerminalGlyph } from "./icons";
import { PairSuccess } from "./PairSuccess";
import { RelayPairingCard, useRelayPairing } from "./RelayPairing";
import { Button, Field, Group, Row, Sheet, StateDot } from "./ui";

/** How the sheet opens: on the account (`home`), or on the direct address, maybe filled from a link. */
export type AddStart = { kind: "home" } | { kind: "direct"; link: string | null };

interface Account {
  serverUrl: string;
  account: string;
}

type Step =
  | { kind: "home" }
  | { kind: "signIn"; serverUrl: string; notice?: string; then?: "code" }
  | { kind: "password"; serverUrl: string; then?: "code" }
  | { kind: "browser"; serverUrl: string; provider: OAuthProvider; session: OAuthSession; then?: "code" }
  | { kind: "code"; account: Account }
  | { kind: "accounts" }
  | { kind: "other" }
  | { kind: "direct" }
  | { kind: "selfHosted" };

/** The sign-ins each relay offers, fetched once per app run. */
const providerCache = new Map<string, Promise<OAuthProvider[]>>();
function providersOf(serverUrl: string): Promise<OAuthProvider[]> {
  let providers = providerCache.get(serverUrl);
  if (providers === undefined) {
    providers = oauthProviders(serverUrl);
    providerCache.set(serverUrl, providers);
    providers.catch(() => providerCache.delete(serverUrl));
  }
  return providers;
}

/** Close the sign-in page where the platform can (iOS); Android has no call for it and returns nothing. */
function closeBrowser(): void {
  try {
    void Promise.resolve(WebBrowser.dismissBrowser()).catch(() => undefined);
  } catch {
    // Nothing to close.
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Adding a computer, in one sheet. Signed in to a relay account, the sheet
 * lists that account's computers and makes the code a new one joins with;
 * signed out, it starts with the account sign-ins the public relay offers.
 * Scanning, a direct address and a self-hosted relay sit under "Other ways".
 */
export function AddComputerSheet({
  visible,
  start,
  machines,
  onAdd,
  onScan,
  onClose,
}: {
  visible: boolean;
  /** Read each time the sheet opens. */
  start: AddStart;
  machines: Machine[];
  onAdd: (machine: Machine) => void;
  onScan: () => void;
  onClose: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [step, setStep] = useState<Step>({ kind: "home" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [current, setCurrent] = useState<Account | null>(null);
  const [computers, setComputers] = useState<RelayLoginResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const machinesRef = useRef(machines);
  machinesRef.current = machines;

  /** A computer just added: the sheet celebrates it, then closes and hands it on once. */
  const [paired, setPaired] = useState<Machine | null>(null);
  const pending = useRef<Machine | null>(null);
  const celebrate = useCallback((machine: Machine) => {
    pending.current = machine;
    setPaired(machine);
  }, []);
  const handOn = useCallback(() => {
    const machine = pending.current;
    if (machine === null) return;
    pending.current = null;
    onClose();
    onAdd(machine);
  }, [onAdd, onClose]);
  const close = useCallback(() => {
    // Dismissed mid-celebration: the computer still counts.
    if (pending.current !== null) return handOn();
    onClose();
  }, [handOn, onClose]);

  const go = useCallback((next: Step) => {
    setError(null);
    setBusy(false);
    setStep(next);
  }, []);

  /** The account's computers, listed on the home step; a refused sign-in sends back to signing in. */
  const listComputers = useCallback(async (account: Account) => {
    setLoading(true);
    setError(null);
    try {
      setComputers(await resumeRelay(account.serverUrl, account.account, machinesRef.current));
    } catch (cause) {
      if (cause instanceof RemoteServerError && (cause.status === 401 || cause.status === 403)) {
        setCurrent(null);
        setComputers(null);
        go({ kind: "signIn", serverUrl: account.serverUrl, notice: t("machines.addSheet.signInAgain") });
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setLoading(false);
    }
  }, [go]);

  // Each opening starts over: the account last used (the public relay's first), or the direct address.
  useEffect(() => {
    if (!visible) return;
    pending.current = null;
    setPaired(null);
    setError(null);
    setBusy(false);
    setComputers(null);
    setStep(start.kind === "direct" ? { kind: "direct" } : { kind: "home" });
    let cancelled = false;
    void savedAccountRelays(machinesRef.current).then((saved) => {
      if (cancelled) return;
      setAccounts(saved);
      const preferred = saved.find((item) => item.serverUrl === DEFAULT_RELAY) ?? saved[0] ?? null;
      setCurrent(preferred);
      if (preferred !== null && start.kind === "home") void listComputers(preferred);
    });
    return () => {
      cancelled = true;
    };
    // `start` is read on opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Signed in (password or browser): this account is the current one; then its list, or a code. */
  const signedIn = useCallback(async (result: RelayLoginResult, then?: "code") => {
    const account = { serverUrl: result.serverUrl, account: result.account };
    setCurrent(account);
    setComputers(result);
    setAccounts(await savedAccountRelays(machinesRef.current));
    go(then === "code" ? { kind: "code", account } : { kind: "home" });
  }, [go]);

  const pick = useCallback((result: RelayLoginResult, deviceId: string) => {
    setBusy(true);
    setError(null);
    void pickRelay(result, deviceId, machinesRef.current)
      .then(celebrate)
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setBusy(false));
  }, [celebrate]);

  let title = t("machines.addSheet.title");
  let body: ReactNode;
  const back = (to: Step = { kind: "home" }) => <BackLink onPress={() => go(to)} />;

  if (paired !== null) {
    body = <PairSuccess name={displayName(paired)} c={colors} onDone={handOn} />;
  } else if (step.kind === "home" && current !== null) {
    body = (
      <SignedIn
        account={current}
        computers={computers}
        loading={loading}
        busy={busy}
        error={error}
        onSwitch={() => go({ kind: "accounts" })}
        onPick={pick}
        onNew={() => go({ kind: "code", account: current })}
        onOther={() => go({ kind: "other" })}
        onRetry={() => void listComputers(current)}
      />
    );
  } else if (step.kind === "home" || step.kind === "signIn") {
    const serverUrl = step.kind === "signIn" ? step.serverUrl : DEFAULT_RELAY;
    const then = step.kind === "signIn" ? step.then : undefined;
    body = (
      <>
        {step.kind === "signIn" ? back() : null}
        <SignInChoices
          serverUrl={serverUrl}
          notice={step.kind === "signIn" ? step.notice : undefined}
          onProvider={(provider, session) => go({ kind: "browser", serverUrl, provider, session, then })}
          onPassword={() => go({ kind: "password", serverUrl, then })}
        />
        {step.kind === "home" ? (
          <OtherWays onScan={onScan} onDirect={() => go({ kind: "direct" })} onSelfHosted={() => go({ kind: "selfHosted" })} />
        ) : null}
      </>
    );
  } else if (step.kind === "browser") {
    title = t("add.browser.title", { name: step.provider.name });
    body = (
      <BrowserSignIn
        step={step}
        onCancel={() => go({ kind: "signIn", serverUrl: step.serverUrl, then: step.then })}
        onSignedIn={(result) => void signedIn(result, step.then)}
        machines={machinesRef}
      />
    );
  } else if (step.kind === "password") {
    title = t("add.password.title");
    body = (
      <>
        {back({ kind: "signIn", serverUrl: step.serverUrl, then: step.then })}
        <PasswordSignIn
          serverUrl={step.serverUrl}
          machines={machinesRef}
          onSignedIn={(result) => void signedIn(result, step.then)}
        />
      </>
    );
  } else if (step.kind === "code") {
    title = t("add.code.title");
    body = (
      <>
        {back()}
        <JoinCode
          account={step.account}
          machines={machinesRef}
          known={new Set(computers?.candidates.map((item) => item.deviceId) ?? [])}
          onJoined={pick}
          onSignIn={(notice) => go({ kind: "signIn", serverUrl: step.account.serverUrl, notice, then: "code" })}
          onCancel={() => go({ kind: "home" })}
        />
      </>
    );
  } else if (step.kind === "accounts") {
    title = t("add.accounts.title");
    body = (
      <>
        {back()}
        <Group>
          {accounts.map((item, index) => (
            <Row
              key={item.serverUrl}
              title={item.account}
              detail={<Text style={styles.detail} numberOfLines={1}>{hostOf(item.serverUrl)}</Text>}
              leading={<GlobeGlyph size={16} color={colors.tileFg} />}
              trailing={current?.serverUrl === item.serverUrl ? <CheckGlyph size={16} color={colors.accent} /> : undefined}
              chevron={false}
              selected={current?.serverUrl === item.serverUrl}
              last={index === accounts.length - 1}
              onPress={() => {
                setCurrent(item);
                setComputers(null);
                go({ kind: "home" });
                void listComputers(item);
              }}
            />
          ))}
        </Group>
        <Button label={t("add.accounts.another")} kind="plain" onPress={() => go({ kind: "signIn", serverUrl: DEFAULT_RELAY })} />
        <Button label={t("add.selfHosted")} kind="plain" onPress={() => go({ kind: "selfHosted" })} />
      </>
    );
  } else if (step.kind === "other") {
    title = t("add.other");
    body = (
      <>
        {back()}
        <OtherWays onScan={onScan} onDirect={() => go({ kind: "direct" })} onSelfHosted={() => go({ kind: "selfHosted" })} bare />
      </>
    );
  } else if (step.kind === "direct") {
    title = t("add.direct");
    body = (
      <>
        {start.kind === "direct" ? null : back()}
        <DirectAddress link={start.kind === "direct" ? start.link : null} machines={machinesRef} onPaired={celebrate} />
      </>
    );
  } else {
    title = t("add.selfHosted");
    body = (
      <>
        {back()}
        <SelfHosted
          accounts={accounts.filter((item) => item.serverUrl !== DEFAULT_RELAY)}
          machines={machinesRef}
          onUse={(item) => {
            setCurrent(item);
            setComputers(null);
            go({ kind: "home" });
            void listComputers(item);
          }}
          onProvider={(serverUrl, provider, session) => go({ kind: "browser", serverUrl, provider, session })}
          onSignedIn={(result) => void signedIn(result)}
        />
      </>
    );
  }

  return (
    <Sheet visible={visible} title={title} onClose={close}>
      {body}
    </Sheet>
  );
}

function hostOf(serverUrl: string): string {
  return serverUrl.replace(/^https?:\/\//, "");
}

function BackLink({ onPress }: { onPress: () => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={styles.back}>
      <BackGlyph size={18} color={colors.tint} />
      <Text style={styles.backText}>{t("common.back")}</Text>
    </Pressable>
  );
}

/** The browser sign-ins `serverUrl` offers, first one prominent, and email + password under them. */
function SignInChoices({
  serverUrl,
  notice,
  onProvider,
  onPassword,
}: {
  serverUrl: string;
  notice?: string;
  onProvider: (provider: OAuthProvider, session: OAuthSession) => void;
  /** Undefined where the email and password fields are already shown. */
  onPassword?: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    setProviders(null);
    providersOf(serverUrl).then((items) => setProviders(preferredFirst(items, getLanguage())), (cause: unknown) => {
      setProviders([]);
      setError(t("add.providersFailed", { error: messageOf(cause) }));
    });
  }, [serverUrl]);
  useEffect(load, [load]);
  const begin = (provider: OAuthProvider) => {
    setStarting(provider.id);
    setError(null);
    startOAuth(serverUrl, provider)
      .then((session) => onProvider(provider, session))
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setStarting(null));
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.lead}>{notice ?? (serverUrl === DEFAULT_RELAY ? t("add.lead") : t("add.leadServer", { server: hostOf(serverUrl) }))}</Text>
      {providers === null ? (
        <View style={styles.center}>
          <Spinner size={14} />
        </View>
      ) : (
        providers.map((provider, index) => (
          <Button
            key={provider.id}
            label={t("add.provider", { name: provider.name })}
            kind={index === 0 ? "primary" : "plain"}
            busy={starting === provider.id}
            disabled={starting !== null}
            onPress={() => begin(provider)}
          />
        ))
      )}
      {error !== null ? (
        <Text style={styles.error} onPress={load}>
          {error}
        </Text>
      ) : null}
      {onPassword === undefined ? null : (
        <Text style={styles.link} accessibilityRole="button" onPress={onPassword}>
          {t("add.password")}
        </Text>
      )}
    </View>
  );
}

/** Scan, direct address, self-hosted relay: the ways that need no account on the public relay. */
function OtherWays({ onScan, onDirect, onSelfHosted, bare = false }: { onScan: () => void; onDirect: () => void; onSelfHosted: () => void; bare?: boolean }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={bare ? undefined : styles.other}>
      {bare ? null : <Text style={styles.section}>{t("add.other")}</Text>}
      <Group>
        <Row title={t("machines.scan")} detail={t("add.scan.detail")} leading={<QrGlyph size={17} color={colors.tileFg} />} onPress={onScan} />
        <Row title={t("add.direct")} detail={t("add.direct.detail")} leading={<TerminalGlyph size={16} color={colors.tileFg} />} onPress={onDirect} />
        <Row title={t("add.selfHosted")} detail={t("add.selfHosted.detail")} leading={<GlobeGlyph size={16} color={colors.tileFg} />} onPress={onSelfHosted} last />
      </Group>
    </View>
  );
}

/** Signed in: the account, its computers (one tap adds one), and the way to add a new one. */
function SignedIn({
  account,
  computers,
  loading,
  busy,
  error,
  onSwitch,
  onPick,
  onNew,
  onOther,
  onRetry,
}: {
  account: Account;
  computers: RelayLoginResult | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onSwitch: () => void;
  onPick: (result: RelayLoginResult, deviceId: string) => void;
  onNew: () => void;
  onOther: () => void;
  onRetry: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const list = computers?.serverUrl === account.serverUrl ? computers : null;
  return (
    <View style={styles.stack}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("add.switchA11y", { account: account.account })} onPress={onSwitch} style={styles.accountChip}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{account.account.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.accountName} numberOfLines={1}>{account.account}</Text>
          <Text style={styles.detail} numberOfLines={1}>{hostOf(account.serverUrl)}</Text>
        </View>
        <Text style={styles.switch}>{t("add.switch")}</Text>
      </Pressable>
      <Text style={styles.section}>{t("add.computers")}</Text>
      {list === null ? (
        <View style={styles.center}>
          {loading ? <Spinner size={14} /> : error !== null ? <Text style={styles.error} onPress={onRetry}>{error}</Text> : null}
        </View>
      ) : list.candidates.length === 0 ? (
        <Text style={styles.lead}>{t("add.noComputers")}</Text>
      ) : (
        <Group>
          {list.candidates.map((item, index) => (
            <Row
              key={item.deviceId}
              title={item.name}
              dim={item.added}
              detail={
                <View style={styles.state}>
                  <StateDot dot={item.online ? "online" : "down"} />
                  <Text style={styles.detail} numberOfLines={1}>
                    {item.added ? t("machines.addSheet.alreadyAdded") : item.online ? t("home.online") : t("add.offline")}
                    {item.added ? "" : ` · ${item.platform}`}
                  </Text>
                </View>
              }
              leading={<ComputerGlyph size={17} color={item.added ? colors.fgFaint : colors.tileFg} />}
              trailing={item.added ? undefined : <Text style={styles.add}>{t("add.add")}</Text>}
              chevron={false}
              last={index === list.candidates.length - 1}
              onPress={item.added || busy ? undefined : () => onPick(list, item.deviceId)}
              accessibilityLabel={item.name}
            />
          ))}
        </Group>
      )}
      {list !== null && error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={t("add.newComputer")} onPress={onNew} disabled={busy} />
      <Text style={styles.hint}>{t("add.newComputer.hint")}</Text>
      <Group>
        <Row title={t("add.other")} detail={t("add.other.summary")} onPress={onOther} last />
      </Group>
    </View>
  );
}

/** Signed in through the browser: the relay's page opens, and the result is collected by polling. */
function BrowserSignIn({
  step,
  machines,
  onCancel,
  onSignedIn,
}: {
  step: Extract<Step, { kind: "browser" }>;
  machines: { current: Machine[] };
  onCancel: () => void;
  onSignedIn: (result: RelayLoginResult) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(() => {
    void WebBrowser.openBrowserAsync(step.session.page).catch((cause: unknown) => setError(messageOf(cause)));
  }, [step.session.page]);
  useEffect(() => {
    open();
    let stopped = false;
    void (async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        if (stopped) return;
        let result;
        try {
          result = await oauthResult(step.serverUrl, step.session);
        } catch {
          continue; // A dropped poll is asked again.
        }
        if (stopped) return;
        if (result.status !== "complete") {
          if (result.status === "pending") continue;
          closeBrowser();
          setError(t("add.browser.expired"));
          return;
        }
        closeBrowser();
        try {
          onSignedIn(await loginRelayWithToken(step.serverUrl, result.token, machines.current));
        } catch (cause) {
          if (!stopped) setError(messageOf(cause));
        }
        return;
      }
    })();
    return () => {
      stopped = true;
    };
    // One sign-in session per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.session.id]);
  return (
    <View style={styles.stack} accessibilityLiveRegion="polite">
      <View style={styles.waitRow}>
        {error === null ? <Spinner size={14} /> : null}
        <Text style={error === null ? styles.lead : styles.error}>{error ?? t("add.browser.waiting", { name: step.provider.name })}</Text>
      </View>
      {error === null ? <Button label={t("add.browser.reopen")} kind="plain" onPress={open} /> : null}
      <Button label={error === null ? t("common.cancel") : t("common.tryAgain")} kind="plain" onPress={onCancel} />
    </View>
  );
}

function PasswordSignIn({ serverUrl, machines, onSignedIn }: { serverUrl: string; machines: { current: Machine[] }; onSignedIn: (result: RelayLoginResult) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await loginRelay(serverUrl, account, password, machines.current));
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.lead}>{t("add.password.lead", { server: hostOf(serverUrl) })}</Text>
      <Field label={t("machines.addSheet.account")} value={account} onChangeText={setAccount} keyboardType="email-address" autoFocus />
      <Field label={t("machines.addSheet.password")} value={password} onChangeText={setPassword} secure />
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={t("add.signIn")} busy={busy} disabled={account.trim() === "" || password === ""} onPress={() => void submit()} />
    </View>
  );
}

/**
 * The code a new computer joins the account with, the commands that use it,
 * and the wait for that computer to show up (then it is added by itself).
 */
function JoinCode({
  account,
  machines,
  known,
  onJoined,
  onSignIn,
  onCancel,
}: {
  account: Account;
  machines: { current: Machine[] };
  known: ReadonlySet<string>;
  onJoined: (result: RelayLoginResult, deviceId: string) => void;
  onSignIn: (notice: string) => void;
  onCancel: () => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [install, setInstall] = useState(false);
  const knownRef = useRef(known);
  const onSignInRef = useRef(onSignIn);
  onSignInRef.current = onSignIn;
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;

  const make = useCallback(async () => {
    setProblem(null);
    setCode(null);
    const token = await savedAccountToken(account.serverUrl);
    if (token === undefined) {
      onSignInRef.current(t("add.code.signIn"));
      return;
    }
    try {
      setCode(await hostRegistrationCode(account.serverUrl, token));
      setNow(Date.now());
    } catch (cause) {
      if (signInNeeded(cause)) {
        await saveAccountToken(account.serverUrl, undefined);
        onSignInRef.current(t("add.code.signIn"));
      } else if (unsupported(cause)) {
        setProblem(t("add.code.unsupported", { server: account.serverUrl }));
      } else {
        setProblem(messageOf(cause));
      }
    }
  }, [account.serverUrl]);
  useEffect(() => {
    void make();
  }, [make]);

  const expired = code !== null && now >= code.expiresAt;
  // The minutes left, and the wait for the computer, while the code is good.
  useEffect(() => {
    if (code === null || expired) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    let stopped = false;
    void waitForNewComputer(account.serverUrl, account.account, knownRef.current, machines.current, () => stopped || Date.now() >= code.expiresAt + 60_000)
      .then((joined) => {
        if (!stopped && joined !== undefined) onJoinedRef.current(joined.result, joined.deviceId);
      })
      .catch((cause: unknown) => {
        if (!stopped) setProblem(messageOf(cause));
      });
    return () => {
      stopped = true;
      clearInterval(tick);
    };
  }, [account, code, expired, machines]);

  const copy = (text: string) => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied((value) => (value === text ? null : value)), 1_500);
    });
  };

  if (problem !== null) {
    return (
      <View style={styles.stack}>
        <Text style={styles.error}>{problem}</Text>
        <Button label={t("common.tryAgain")} kind="plain" onPress={() => void make()} />
      </View>
    );
  }
  if (code === null) {
    return (
      <View style={styles.center}>
        <Spinner size={14} />
      </View>
    );
  }
  const commands = joinCommands(account.serverUrl, code.code);
  const minutes = Math.max(1, Math.ceil((code.expiresAt - now) / 60_000));
  return (
    <View style={styles.stack}>
      <Text style={styles.lead}>{t("add.code.lead")}</Text>
      <Text style={[styles.code, expired && styles.codeExpired]} selectable accessibilityLabel={code.code.split("").join(" ")}>
        {code.code}
      </Text>
      <Text style={styles.codeNote}>{expired ? t("add.code.expired") : t("add.code.expires", { minutes })}</Text>
      {expired ? (
        <Button label={t("add.code.renew")} onPress={() => void make()} />
      ) : (
        <>
          <CommandBox text={commands.omp} copied={copied === commands.omp} onCopy={copy} />
          <Text style={styles.section}>{t("add.code.terminal")}</Text>
          <CommandBox text={commands.terminal} copied={copied === commands.terminal} onCopy={copy} />
          <View style={styles.waitRow} accessibilityLiveRegion="polite">
            <Spinner size={12} />
            <Text style={styles.lead}>{t("add.code.waiting")}</Text>
          </View>
          <Text style={styles.hint}>{t("add.code.after")}</Text>
        </>
      )}
      <Button label={t("common.cancel")} kind="plain" onPress={onCancel} />
      <Text style={styles.link} accessibilityRole="button" onPress={() => setInstall((value) => !value)}>
        {t("add.code.install")}
      </Text>
      {install ? <Text style={[styles.hint, { color: colors.fgMuted }]}>{t("add.code.installHow")}</Text> : null}
    </View>
  );
}

function CommandBox({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: (text: string) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("add.code.copyA11y", { text })} onPress={() => onCopy(text)} style={styles.command}>
      <Text style={styles.commandText} selectable>{text}</Text>
      {copied ? <CheckGlyph size={15} color={colors.ok} /> : <CopyGlyph size={15} color={colors.fgFaint} />}
    </Pressable>
  );
}

/** A tailnet or LAN address with its token, a pairing link, or a pasted relay pairing link. */
function DirectAddress({ link, machines, onPaired }: { link: string | null; machines: { current: Machine[] }; onPaired: (machine: Machine) => void }): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const prefill = link === null ? undefined : readPairing(link);
  const [url, setUrl] = useState(prefill === undefined ? "" : prefill.ok ? prefill.url : (link ?? ""));
  const [token, setToken] = useState(prefill?.ok === true ? prefill.token : "");
  const [error, setError] = useState<string | null>(prefill !== undefined && !prefill.ok ? pairingMessage(prefill.problem, prefill.host) : null);
  const [busy, setBusy] = useState(false);
  const relay = useRelayPairing(machines.current, onPaired);
  const ticket = parsePairingTicket(url.trim());
  // Leaving the step stops a relay pairing in flight.
  useEffect(() => relay.cancel, [relay.cancel]);

  const connect = async () => {
    if (ticket !== undefined) {
      setError(null);
      relay.start(ticket);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let base: string;
      let secret: string;
      if (isPairingLink(url)) {
        const pairing = readPairing(url);
        if (!pairing.ok) throw new Error(pairingMessage(pairing.problem, pairing.host));
        base = pairing.url;
        secret = pairing.token;
      } else {
        base = normalizeUrl(url);
        secret = token;
      }
      onPaired(await pairMachine(base, secret, machines.current));
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  };
  if (relay.busy) return <RelayPairingCard code={relay.code} c={colors} onCancel={relay.cancel} />;
  return (
    <View style={styles.stack}>
      <Field label={t("machines.addSheet.address")} value={url} onChangeText={setUrl} placeholder={t("machines.addSheet.addressPlaceholder")} autoFocus={link === null} />
      {ticket === undefined && !isPairingLink(url) ? <Field label={t("machines.addSheet.token")} value={token} onChangeText={setToken} secure /> : null}
      {(relay.error ?? error) !== null ? <Text style={styles.error}>{relay.error ?? error}</Text> : null}
      <Button
        label={t("machines.addSheet.connect")}
        onPress={() => void connect()}
        busy={busy}
        disabled={url.trim() === "" || (token.trim() === "" && !isPairingLink(url) && ticket === undefined)}
      />
      <Text style={styles.hint}>{t("add.direct.hint")}</Text>
    </View>
  );
}

/** A relay of one's own: its address first, then what it offers (browser sign-ins, account + password). */
function SelfHosted({
  accounts,
  machines,
  onUse,
  onProvider,
  onSignedIn,
}: {
  accounts: Account[];
  machines: { current: Machine[] };
  onUse: (account: Account) => void;
  onProvider: (serverUrl: string, provider: OAuthProvider, session: OAuthSession) => void;
  onSignedIn: (result: RelayLoginResult) => void;
}): ReactNode {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [address, setAddress] = useState("");
  const [server, setServer] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const check = () => {
    setProblem(null);
    try {
      setServer(relayUrl(address));
    } catch (cause) {
      setProblem(messageOf(cause));
    }
  };
  return (
    <View style={styles.stack}>
      <Field
        label={t("add.selfHosted.server")}
        value={address}
        onChangeText={(value) => {
          setAddress(value);
          setServer(null);
        }}
        placeholder="relay.example.com"
        keyboardType="url"
        autoFocus={accounts.length === 0}
      />
      {problem !== null ? <Text style={styles.error}>{problem}</Text> : null}
      {server === null ? (
        <Button label={t("add.selfHosted.continue")} disabled={address.trim() === ""} onPress={check} />
      ) : (
        <>
          <SignInChoices
            serverUrl={server}
            onProvider={(provider, session) => onProvider(server, provider, session)}
            key={server}
          />
          <PasswordSignIn serverUrl={server} machines={machines} onSignedIn={onSignedIn} key={`${server}#password`} />
        </>
      )}
      {accounts.length > 0 ? (
        <>
          <Text style={styles.section}>{t("add.selfHosted.recent")}</Text>
          <Group>
            {accounts.map((item, index) => (
              <Row
                key={item.serverUrl}
                title={hostOf(item.serverUrl)}
                detail={item.account}
                leading={<GlobeGlyph size={16} color={colors.tileFg} />}
                last={index === accounts.length - 1}
                onPress={() => onUse(item)}
              />
            ))}
          </Group>
        </>
      ) : null}
    </View>
  );
}

function createStyles(c: Palette) {
  return {
    stack: { gap: 12 },
    flex: { flex: 1, minWidth: 0 },
    center: { alignItems: "center", justifyContent: "center", paddingVertical: 18 },
    lead: { flexShrink: 1, fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.fgMuted, marginHorizontal: 2 },
    hint: { fontFamily: SANS, fontSize: 12.5, lineHeight: 18, color: c.fgFaint, marginHorizontal: 2, textAlign: "center" },
    section: { fontFamily: MONO, fontSize: 10.5, lineHeight: 14, letterSpacing: 1.2, textTransform: "uppercase", color: c.fgFaint, marginHorizontal: 2, marginTop: 4 },
    link: { fontFamily: SANS, fontSize: 13.5, lineHeight: 20, color: c.tint, textAlign: "center", paddingVertical: 4 },
    error: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.err, marginHorizontal: 2 },
    detail: { flexShrink: 1, fontFamily: MONO, fontSize: 11.5, lineHeight: 16, color: c.fgMuted },
    state: { flexDirection: "row", alignItems: "center", gap: 5 },
    other: { gap: 8, marginTop: 10 },
    back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginTop: -6, marginBottom: 2, marginLeft: -4 },
    backText: { fontFamily: SANS, fontSize: 14, lineHeight: 20, color: c.tint },
    accountChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: c.well,
      borderWidth: 0.5,
      borderColor: c.border,
    },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: `${c.accent}26` },
    avatarText: { fontFamily: SANS, fontSize: 15, fontWeight: "600", color: c.accent },
    accountName: { fontFamily: SANS, fontSize: 15, lineHeight: 20, fontWeight: "600", color: c.fg },
    switch: { fontFamily: SANS, fontSize: 14, fontWeight: "500", color: c.tint },
    add: { fontFamily: SANS, fontSize: 14, fontWeight: "600", color: c.tint },
    waitRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 2 },
    code: { fontFamily: MONO, fontSize: 34, lineHeight: 42, fontWeight: "600", letterSpacing: 3, textAlign: "center", color: c.fg, marginTop: 4 },
    codeExpired: { color: c.fgFaint, textDecorationLine: "line-through" },
    codeNote: { fontFamily: SANS, fontSize: 12.5, lineHeight: 18, textAlign: "center", color: c.fgFaint, marginTop: -6 },
    command: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.lg,
      backgroundColor: c.well,
      borderWidth: 0.5,
      borderColor: c.border,
    },
    commandText: { flex: 1, fontFamily: MONO, fontSize: 13, lineHeight: 18, color: c.fg },
  } as const;
}
