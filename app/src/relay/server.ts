/**
 * This phone's standing with a ds-harness-remote relay server after pairing:
 * its device token pair (refreshed before use), the computers it may reach,
 * and their pinned identity keys. Endpoints from ds-harness-remote
 * `docs/protocol.md` §8 and `docs/device-pairing-v1.md` §6.
 */
import { t } from "../i18n/index.ts";
import { z } from "zod";
import type { PairingTokens } from "./pairing";

const tokensSchema = z.object({
  accessToken: z.string().min(16),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z.string().min(16),
  refreshTokenExpiresAt: z.number().int().positive(),
});

const hostSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string(),
  platform: z.string(),
  role: z.literal("host"),
  membershipId: z.string().min(1),
  online: z.boolean().optional(),
  lastSeenAt: z.number().nullable().optional(),
  clientVersion: z.string().nullable().optional(),
  harnessVersion: z.string().nullable().optional(),
});

const peerSchema = hostSchema.extend({ identityKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** A Host as the server lists it for this phone. */
export type RemoteHostListing = z.infer<typeof hostSchema>;
/** A Host with the identity key its Noise session must prove. */
export type RemoteHost = z.infer<typeof peerSchema>;

/** Refresh a minute before expiry, so a request never races the deadline. */
const EARLY_MS = 60_000;

export class RemoteServerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RemoteServerError";
    this.status = status;
  }
}

export class RemoteServerApi {
  readonly serverUrl: string;
  readonly deviceId: string;
  private tokens: PairingTokens;
  private readonly onTokens: (tokens: PairingTokens) => void | Promise<void>;
  private refreshing: Promise<PairingTokens> | undefined;

  /**
   * @param onTokens Called with every new token pair, to be stored before it is used.
   */
  constructor(serverUrl: string, deviceId: string, tokens: PairingTokens, onTokens: (tokens: PairingTokens) => void | Promise<void>) {
    this.serverUrl = serverUrl;
    this.deviceId = deviceId;
    this.tokens = tokens;
    this.onTokens = onTokens;
  }

  /** A valid access token, refreshing it first when it is about to expire. */
  async accessToken(): Promise<string> {
    if (this.tokens.accessTokenExpiresAt - EARLY_MS > Date.now()) return this.tokens.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Rotate the token pair; concurrent callers share one refresh. */
  refresh(): Promise<PairingTokens> {
    this.refreshing ??= (async () => {
      const response = await fetch(`${this.serverUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: this.deviceId, refreshToken: this.tokens.refreshToken }),
      });
      if (!response.ok) throw new RemoteServerError(response.status, t("relay.renewRefused"));
      const next = tokensSchema.parse(await response.json());
      await this.onTokens(next);
      this.tokens = next;
      return next;
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async request(path: string, method = "GET"): Promise<Response> {
    const send = async (token: string) => fetch(`${this.serverUrl}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    let response = await send(await this.accessToken());
    if (response.status === 401) response = await send((await this.refresh()).accessToken);
    if (!response.ok) throw new RemoteServerError(response.status, `${path}: HTTP ${response.status}`);
    return response;
  }

  /** The Hosts this phone is authorized for, with online state. */
  async hosts(): Promise<RemoteHostListing[]> {
    const body = z.object({ items: z.array(z.unknown()) }).parse(await (await this.request("/api/v1/devices")).json());
    return body.items.flatMap((item) => {
      const host = hostSchema.safeParse(item);
      return host.success ? [host.data] : [];
    });
  }

  /** One Host with the identity key its Noise session must prove. */
  async host(deviceId: string): Promise<RemoteHost> {
    return peerSchema.parse(await (await this.request(`/api/v1/devices/${encodeURIComponent(deviceId)}`)).json());
  }

  /** End this phone's pairing with one computer (the server drops the membership; its connections close). */
  async revoke(hostDeviceId: string): Promise<void> {
    await this.request(`/api/v1/device-memberships/${encodeURIComponent(hostDeviceId)}`, "DELETE");
  }
}
