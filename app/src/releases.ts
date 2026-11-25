const REPOSITORY = "Rinai-R/omp-mobile";
/** Where a release's notes and older versions live, opened from the update sheet. */
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/** Notes are shown in a sheet: a runaway body would be megabytes of scroll. */
const NOTES_LIMIT = 12_000;

export interface ApkUpdate {
  version: string;
  url: string;
  sha256: string;
  /** The APK's size, for the download button; 0 when GitHub did not say. */
  bytes: number;
}

/** One release newer than the installed app: what the update sheet lists. */
export interface ReleaseEntry {
  version: string;
  /** The release body, as GitHub holds it (Markdown). */
  notes: string;
  url: string;
  publishedAt: number;
}

export interface UpdateOffer {
  /** Every newer stable release, newest first: the differences the phone skipped over. */
  versions: ReleaseEntry[];
  /** The newest release that ships an APK with a digest to verify it against. */
  target: ApkUpdate;
}

interface Release {
  tag_name: string;
  draft: unknown;
  prerelease: unknown;
  assets: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
}

function isRelease(value: unknown): value is Release {
  return value !== null && typeof value === "object" && "tag_name" in value;
}

/** Whether a saved update is newer than the installed version. */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const next = VERSION.exec(candidate);
  const current = VERSION.exec(installed);
  return next !== null && current !== null && newer(next, current);
}

/** A prerelease of the same version is older than the release. */
function newer(a: RegExpExecArray, b: RegExpExecArray): boolean {
  const difference = Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3]);
  if (difference !== 0) return difference > 0;
  if (a[4] === undefined) return b[4] !== undefined;
  return b[4] === undefined ? false : a[4] > b[4];
}

/** The APK a release publishes, when it is uploaded and carries a SHA-256 digest. */
function apkOf(release: Release): ApkUpdate | null {
  const tag = release.tag_name;
  const apkName = `OMP-Mobile-${tag}.apk`;
  if (!Array.isArray(release.assets)) return null;
  const apk = release.assets.find((asset): asset is { name: string; state: string; digest?: unknown; size?: unknown } =>
    asset !== null && typeof asset === "object" && "name" in asset && asset.name === apkName
    && "state" in asset && asset.state === "uploaded",
  );
  const digest = apk?.digest;
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) return null;
  const bytes = typeof apk?.size === "number" && Number.isFinite(apk.size) ? apk.size : 0;
  return { version: tag.slice(1), url: `${RELEASES_PAGE}/download/${tag}/${apkName}`, sha256: digest.slice("sha256:".length), bytes };
}

/**
 * A release body as one reader should see it: the CHANGELOG section CI
 * publishes, in the reader's language. The section is English with a
 * `### 中文` part; GitHub may append its generated "What's Changed" list and
 * compare link, which is for the repository, not the phone.
 */
export function notesFor(body: string, language: "en" | "zh-CN"): string {
  const own = body.split(/^##\s+What's Changed\s*$/m)[0] ?? "";
  const trimmed = own.split(/^\*\*Full Changelog\*\*/m)[0] ?? "";
  const [english = "", chinese] = trimmed.split(/^###\s*中文\s*$/m);
  const picked = language === "zh-CN" && chinese !== undefined && chinese.trim() !== "" ? chinese : english;
  return picked.trim();
}

/**
 * What a phone on `installedVersion` can update to: every stable release newer
 * than it, newest first, with the notes of each, and the newest one that ships
 * a verifiable APK. Null when nothing newer ships one (or nothing is newer).
 */
export function findUpdates(installedVersion: string, payload: unknown): UpdateOffer | null {
  const installed = VERSION.exec(installedVersion);
  if (!Array.isArray(payload) || installed === null) return null;
  const entries: { release: Release; version: string; parsed: RegExpExecArray }[] = [];
  for (const value of payload) {
    if (!isRelease(value) || value.draft !== false || value.prerelease !== false) continue;
    if (!value.tag_name.startsWith("v")) continue;
    const version = value.tag_name.slice(1);
    const parsed = VERSION.exec(version);
    // A release tag is a plain version here: a prerelease tag is not an update for anyone.
    if (parsed === null || parsed[4] !== undefined) continue;
    if (!newer(parsed, installed)) continue;
    entries.push({ release: value, version, parsed });
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => (newer(a.parsed, b.parsed) ? -1 : 1));
  // A newer release whose APK is not up yet (CI still uploading) is left out: the sheet lists what it installs.
  const index = entries.findIndex(({ release }) => apkOf(release) !== null);
  if (index === -1) return null;
  const target = apkOf(entries[index]!.release)!;
  const versions = entries.slice(index).map(({ release, version }) => ({
    version,
    notes: typeof release.body === "string" ? release.body.slice(0, NOTES_LIMIT) : "",
    url: typeof release.html_url === "string" ? release.html_url : `${RELEASES_PAGE}/tag/v${version}`,
    publishedAt: typeof release.published_at === "string" ? Date.parse(release.published_at) || 0 : 0,
  }));
  return { versions, target };
}
