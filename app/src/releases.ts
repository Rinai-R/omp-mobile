const REPOSITORY = "Rinai-R/omp-mobile";
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface ApkUpdate {
  version: string;
  url: string;
  sha256: string;
}

export function findApkUpdate(installedVersion: string, payload: unknown): ApkUpdate | null {
  if (payload === null || typeof payload !== "object") return null;
  const release = payload as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") return null;

  const tag = release.tag_name;
  if (!tag.startsWith("v")) return null;
  const version = tag.slice(1);
  const latest = VERSION.exec(version);
  const installed = VERSION.exec(installedVersion);
  if (!latest || latest[4] || !installed) return null;
  const difference = Number(latest[1]) - Number(installed[1])
    || Number(latest[2]) - Number(installed[2])
    || Number(latest[3]) - Number(installed[3]);
  if (difference < 0 || (difference === 0 && !installed[4])) return null;

  const apkName = `OMP-Mobile-${tag}.apk`;
  if (!Array.isArray(release.assets)) return null;
  const apk = (release.assets as unknown[]).find((asset): asset is { name: string; state: string; digest?: unknown } =>
    asset !== null && typeof asset === "object" && "name" in asset && asset.name === apkName
    && "state" in asset && asset.state === "uploaded",
  );
  const digest = apk?.digest;
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) return null;

  return { version, url: `${RELEASES_URL}/download/${tag}/${apkName}`, sha256: digest.slice("sha256:".length) };
}
