/**
 * Files a session wrote or named, as the chat offers them for download: which
 * paths a tool call wrote, which a reply mentions, and how a download that the
 * daemon refused reads. The daemon applies the same rules
 * (`daemon/src/session-files.mjs`); the phone only shows a mentioned file the
 * daemon listed as present, so a stray word never becomes a card.
 *
 * Nothing here needs React Native, so node:test loads it.
 */
import { t, type Key } from "./i18n/index.ts";
import type { SessionFile, ToolItem } from "./types";

/** What one reply's strip offers: an absolute path, and what the daemon's list says of it (undefined: not listed, or not yet fetched). */
export interface FileRef {
  path: string;
  name: string;
  entry?: SessionFile;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The tools that write files: their target is `path` (or `file_path`), or what an `input` patch names. */
const WRITERS: Record<string, true> = { write: true, edit: true, multi_edit: true, apply_patch: true };
/** A hashline edit's file header: `[src/app.ts#7D03]`. */
const HASHLINE_HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]\s*$/;
/** A hashline rename of the file above it: `MV dest`, the destination optionally quoted. */
const HASHLINE_MOVE = /^MV\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s*$/;
/** An apply_patch file header that writes its path: added, updated, or the destination of a move. */
const PATCH_TARGET = /^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/;

/** The paths a call wrote, as it named them (maybe relative to the session's directory); none for a failed call. */
export function writtenPaths(tool: ToolItem): string[] {
  if (tool.status === "error" || WRITERS[tool.name] !== true) return [];
  const args = record(tool.args);
  if (args === undefined) return [];
  const path = str(args.path) ?? str(args.file_path);
  if (path !== undefined) return [path];
  if (tool.name === "apply_patch") {
    if (typeof args.input !== "string") return [];
    return args.input.split("\n").flatMap((line) => {
      const target = PATCH_TARGET.exec(line);
      return target === null ? [] : [target[1] as string];
    });
  }
  if (tool.name !== "edit" || typeof args.input !== "string") return [];
  const paths: string[] = [];
  let current = false;
  for (const line of args.input.split("\n")) {
    const header = HASHLINE_HEADER.exec(line);
    if (header !== null) {
      paths.push(header[1] as string);
      current = true;
      continue;
    }
    const move = current ? HASHLINE_MOVE.exec(line) : null;
    if (move !== null) {
      const dest = move[1] ?? move[2] ?? move[3];
      if (dest !== undefined && dest !== "") paths.push(dest);
    }
  }
  return paths;
}

/** An absolute POSIX path with `.`, `..` and repeated or trailing slashes resolved. */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** `path` as an absolute path on the computer; undefined for a home path (the phone does not know the home) or a relative one without a directory. */
export function resolvePath(path: string, cwd: string): string | undefined {
  if (path === "" || path.startsWith("~")) return undefined;
  if (path.startsWith("/")) return normalizePath(path);
  if (!cwd.startsWith("/")) return undefined;
  return normalizePath(`${cwd}/${path}`);
}

/** Whether `path` lies inside the directory `cwd` (not the directory itself). */
export function isUnder(path: string, cwd: string): boolean {
  const base = normalizePath(cwd);
  if (base === "/") return path.startsWith("/") && path !== "/";
  return path.startsWith(`${base}/`);
}

/** A run of path characters in prose. */
const TOKEN = /[\p{L}\p{N}_@+%=.~/-]+/gu;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
const LETTER = /\p{L}/u;

/** A token that may name a file: a letter, and a slash or an extension. */
function qualifies(token: string): boolean {
  return LETTER.test(token) && (token.includes("/") || EXTENSION.test(token));
}

/** Everything up to and including a run's last non-ASCII character. */
const NON_ASCII_LEAD = /^.*[^\x00-\x7f]/su;

/**
 * The words of `text` that may name files, in order: runs of path characters
 * without trailing dots, except URLs (`//…`) and
 * directories (a trailing `/`). A run that starts in non-ASCII prose
 * (`已写入report.md`) also offers what follows its last non-ASCII character.
 */
export function mentionTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0].replace(/\.+$/, "");
    if (token === "" || token.startsWith("//") || token.endsWith("/")) continue;
    if (qualifies(token)) tokens.push(token);
    if (!/^[^\x00-\x7f]/u.test(token)) continue;
    const suffix = token.replace(NON_ASCII_LEAD, "");
    if (suffix !== "" && !suffix.startsWith(".") && qualifies(suffix)) tokens.push(suffix);
  }
  return tokens;
}

/** The files `text` names inside `cwd`, as absolute paths, each once, in order. */
export function mentionedPaths(text: string, cwd: string): string[] {
  if (!cwd.startsWith("/")) return [];
  const paths: string[] = [];
  for (const token of mentionTokens(text)) {
    const path = resolvePath(token, cwd);
    if (path !== undefined && isUnder(path, cwd) && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * What a turn's strip offers: the files its calls wrote, always (the list
 * says whether one is gone), then those its reply names that the daemon
 * listed as present. Before the list arrives (`list` null), the writes only.
 */
export function replyFiles(written: readonly string[], text: string, cwd: string, list: readonly SessionFile[] | null): FileRef[] {
  const listed = new Map((list ?? []).map((entry) => [entry.path, entry]));
  const refs: FileRef[] = [];
  const add = (path: string) => {
    if (refs.some((ref) => ref.path === path)) return;
    const entry = listed.get(path);
    refs.push(entry === undefined ? { path, name: fileName(path) } : { path, name: entry.name, entry });
  };
  for (const raw of written) {
    const path = resolvePath(raw, cwd);
    if (path !== undefined) add(path);
  }
  if (list !== null) {
    for (const path of mentionedPaths(text, cwd)) if (listed.get(path)?.exists === true) add(path);
  }
  return refs;
}

export function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  json: "application/json",
  apk: "application/vnd.android.package-archive",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  xml: "text/xml",
};

/** Source and config files: plain text, so any text viewer takes them. */
const TEXT_EXTENSION = /^(?:tsx?|jsx?|[mc]js|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|bash|zsh|ya?ml|toml|ini|conf|sql|lua|php|pl|r|scala|vue|svelte)$/;

/** The MIME type the share sheet is told, from the name's extension. */
export function mimeType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  const extension = name.slice(dot + 1).toLowerCase();
  return MIME_TYPES[extension] ?? (TEXT_EXTENSION.test(extension) ? "text/plain" : "application/octet-stream");
}

/** `512 B`, `1.5 KB`, `20 KB`, `100 MB`. */
export function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}

/** A running download: a percentage when the whole size is known, else the bytes so far. */
export function progressLabel(received: number, total: number | undefined): string {
  if (total !== undefined && total > 0) return `${Math.min(100, Math.floor((received / total) * 100))}%`;
  return humanSize(received);
}

/** Where a download is written: its own directory under the cache, so two files of one name do not meet. */
export function downloadTarget(cacheDirectory: string, path: string, key: string): string {
  return `${cacheDirectory.replace(/\/+$/, "")}/files/${key}/${encodeURIComponent(fileName(path))}`;
}

/** The daemon refused a download (`GET /sessions/:id/file`): its status and the reason it gave. */
export class FileDownloadError extends Error {
  readonly status: number;
  /** `gone`, `too_large`, `sensitive`, `not_session_file`, `outside_cwd`, `bad_path`, `not_file`; undefined for an unknown session or a non-JSON answer. */
  readonly code: string | undefined;
  /** For `too_large`: the request came through a relay, whose limit is lower. */
  readonly relay: boolean;
  readonly limit: number | undefined;
  readonly size: number | undefined;

  constructor(status: number, message: string, fields: { code?: string; relay?: boolean; limit?: number; size?: number } = {}) {
    super(message);
    this.name = "FileDownloadError";
    this.status = status;
    this.code = fields.code;
    this.relay = fields.relay === true;
    this.limit = fields.limit;
    this.size = fields.size;
  }
}

/** The error for a non-2xx answer whose body is `body`: the daemon's `{error, code, …}`, else the status. */
export function downloadError(status: number, body: string): FileDownloadError {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = record(JSON.parse(body));
  } catch {
    parsed = undefined;
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  return new FileDownloadError(status, str(parsed?.error) ?? `HTTP ${status}`, {
    code: str(parsed?.code),
    relay: parsed?.relay === true,
    limit: number(parsed?.limit),
    size: number(parsed?.size),
  });
}

/** The catalog key that explains a failed download; anything that is not the daemon's answer is the network. */
export function downloadErrorKey(error: unknown): Key {
  if (!(error instanceof FileDownloadError)) return "files.error.network";
  switch (error.code) {
    case "gone":
      return "files.error.gone";
    case "too_large":
      return error.relay ? "files.error.tooLargeRelay" : "files.error.tooLarge";
    case "sensitive":
      return "files.error.sensitive";
    case "not_session_file":
      return "files.error.notSessionFile";
    case "outside_cwd":
      return "files.error.outsideCwd";
    case "not_file":
      return "files.error.notFile";
    case "bad_path":
      return "files.error.badPath";
    default:
      return error.status === 404 ? "files.error.session" : "files.error.http";
  }
}

/** A failed download in the app's language. */
export function downloadErrorMessage(error: unknown): string {
  const key = downloadErrorKey(error);
  if (key === "files.error.tooLarge") {
    const limit = error instanceof FileDownloadError ? error.limit : undefined;
    return t(key, { limit: limit === undefined ? "?" : humanSize(limit) });
  }
  if (key === "files.error.http") return t(key, { status: error instanceof FileDownloadError ? error.status : 0 });
  return t(key);
}
