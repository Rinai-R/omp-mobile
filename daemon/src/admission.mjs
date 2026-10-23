/**
 * Tailscale identity admission for the daemon listener.
 *
 * The bearer token proves the client was paired; admission proves the request
 * reached this node on purpose (Host names this node) and comes from a device
 * of the same tailnet user (`tailscale whois`). Both run before the token.
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

const MAC_APP_BINARY = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const TIMEOUT_MS = 5_000;
const WHOIS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 5_000;

/** @typedef {{ips: string[], dnsName: string, userId: number, loginName: string}} SelfStatus */
/** @typedef {{userId: number, loginName: string, tags: string[], node: string}} WhoisResult */

/**
 * Run a command and resolve its stdout.
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function run(binary, args) {
  return new Promise((resolveRun, reject) => {
    execFile(binary, args, { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolveRun(stdout);
    });
  });
}

/** Thin wrapper over the local `tailscale` CLI. */
class Tailscale {
  /**
   * @param {{binary?: string, run?: typeof run, platform?: string}} [options]
   */
  constructor(options = {}) {
    this.binary = options.binary ?? "tailscale";
    this.run = options.run ?? run;
    // A bare "tailscale" that is not on PATH falls back to the macOS app bundle.
    this.fallbacks =
      this.binary === "tailscale" && (options.platform ?? platform()) === "darwin" ? [MAC_APP_BINARY] : [];
  }

  /** @param {string[]} args */
  async exec(args) {
    try {
      return await this.run(this.binary, args);
    } catch (error) {
      if (error?.code !== "ENOENT" || this.fallbacks.length === 0) throw error;
      const next = this.fallbacks.shift();
      this.binary = next;
      return this.exec(args);
    }
  }

  /** @returns {Promise<SelfStatus>} */
  async status() {
    const raw = JSON.parse(await this.exec(["status", "--json"]));
    const self = raw?.Self ?? {};
    if (raw?.BackendState !== undefined && raw.BackendState !== "Running") {
      throw new Error(`tailscale is not running (BackendState ${raw.BackendState})`);
    }
    const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.map(String) : [];
    const userId = Number(self.UserID ?? 0);
    const profile = raw?.User?.[String(userId)];
    return {
      ips,
      dnsName: String(self.DNSName ?? "").replace(/\.$/, "").toLowerCase(),
      userId: Number.isFinite(userId) ? userId : 0,
      loginName: typeof profile?.LoginName === "string" ? profile.LoginName : "",
    };
  }

  /**
   * Identify the node and user behind an address. Rejects when the CLI fails,
   * which includes addresses outside the tailnet (whois exits non-zero).
   * @param {string} ip
   * @returns {Promise<WhoisResult>}
   */
  async whois(ip) {
    const raw = JSON.parse(await this.exec(["whois", "--json", ip]));
    const userId = Number(raw?.Node?.User ?? raw?.UserProfile?.ID ?? 0);
    return {
      userId: Number.isFinite(userId) ? userId : 0,
      loginName: typeof raw?.UserProfile?.LoginName === "string" ? raw.UserProfile.LoginName : "",
      tags: Array.isArray(raw?.Node?.Tags) ? raw.Node.Tags.map(String) : [],
      node: String(raw?.Node?.Name ?? "").replace(/\.$/, ""),
    };
  }
}

/**
 * Host header without port, brackets, trailing dot; lower case.
 * @param {string | undefined} host
 */
function hostnameOf(host) {
  if (typeof host !== "string") return "";
  const bracket = /^\[([^\]]+)\]/.exec(host);
  const name = bracket === null ? host.replace(/:\d+$/, "") : bracket[1];
  return name.toLowerCase().replace(/\.$/, "");
}

/**
 * Socket remote address with IPv4-mapped IPv6 reduced to dotted IPv4.
 * @param {string | undefined} address
 */
function remoteIp(address) {
  if (typeof address !== "string") return "";
  return address.toLowerCase().startsWith("::ffff:") && address.includes(".") ? address.slice(7) : address;
}

/** @param {string} host */
function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "[::1]";
}

/**
 * @typedef {{ok: true, ip: string, user: string} | {ok: false, status: number, error: string, ip: string}} Verdict
 */

/** Listener admission: Host names this node, source is a device of this node's user. */
class Admission {
  /**
   * @param {{
   *   self: SelfStatus,
   *   bindHost: string,
   *   tailscale?: {whois(ip: string): Promise<WhoisResult>},
   *   whois?: boolean,
   *   now?: () => number,
   * }} options
   */
  constructor(options) {
    this.self = options.self;
    this.tailscale = options.tailscale;
    this.whoisEnabled = options.whois !== false;
    this.now = options.now ?? Date.now;
    this.hosts = new Set(
      [hostnameOf(options.bindHost), ...options.self.ips.map((ip) => ip.toLowerCase()), options.self.dnsName]
        .filter(Boolean),
    );
    this.ownIps = new Set(options.self.ips.map((ip) => ip.toLowerCase()));
    /** Pending or settled lookups per address; concurrent requests share one. */
    /** @type {Map<string, {expires: number, who: Promise<WhoisResult | undefined>}>} */
    this.cache = new Map();
  }

  /**
   * @param {{headers: Record<string, string | string[] | undefined>, socket: {remoteAddress?: string}}} req
   * @returns {Promise<Verdict>}
   */
  async check(req) {
    const ip = remoteIp(req.socket?.remoteAddress);
    const host = hostnameOf(/** @type {string | undefined} */ (req.headers.host));
    if (!this.hosts.has(host)) {
      return { ok: false, status: 421, ip, error: `misdirected request: host "${host}" does not name this node` };
    }
    if (!this.whoisEnabled) return { ok: true, ip, user: "" };
    // This node's own addresses belong to its user; the token still applies.
    if (this.ownIps.has(ip.toLowerCase())) return { ok: true, ip, user: this.self.loginName };
    const who = await this.identify(ip);
    if (who === undefined) {
      return { ok: false, status: 403, ip, error: `source ${ip} is not a known tailnet device` };
    }
    if (who.tags.length > 0) {
      return { ok: false, status: 403, ip, error: `source ${ip} is a tagged device (${who.tags.join(", ")}); tagged devices have no user` };
    }
    if (who.userId === 0 || who.userId !== this.self.userId) {
      return {
        ok: false,
        status: 403,
        ip,
        error: `source ${ip} belongs to ${who.loginName || "another user"}, not ${this.self.loginName || "this node's user"}`,
      };
    }
    return { ok: true, ip, user: who.loginName };
  }

  /**
   * Whois with a cache: identities for 60 s, failures for 5 s.
   * @param {string} ip
   */
  identify(ip) {
    const now = this.now();
    const hit = this.cache.get(ip);
    if (hit !== undefined && now < hit.expires) return hit.who;
    const slot = { expires: now + WHOIS_TTL_MS, who: Promise.resolve(undefined) };
    slot.who = Promise.resolve()
      .then(() => this.tailscale?.whois(ip))
      .then(
        (found) => {
          if (found === undefined) slot.expires = this.now() + FAILURE_TTL_MS;
          return found;
        },
        () => {
          slot.expires = this.now() + FAILURE_TTL_MS;
          return undefined;
        },
      );
    this.cache.set(ip, slot);
    return slot.who;
  }
}

export { Admission, Tailscale, hostnameOf, remoteIp, isLoopbackHost, MAC_APP_BINARY };
