/**
 * Files a session wrote or named, for the phone to download
 * (`GET /sessions/:id/files`, `GET /sessions/:id/file?path=`).
 *
 * A session may hand over a file it wrote with its own write/edit tool calls
 * (wherever it lies), or one an assistant reply names that lies under the
 * session's directory. Nothing else on the computer is reachable: the request
 * names an absolute path that must be one of those, is checked again after
 * resolving symbolic links, and is refused when it looks like a secret.
 */
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, normalize, resolve, sep } from "node:path";

/** A file is sent whole: at most this large straight to the phone, and through the relay (which holds it in memory). */
export const MAX_DIRECT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_RELAY_FILE_BYTES = 20 * 1024 * 1024;
/** Files `GET /sessions/:id/files` lists at most, newest first. */
const LIST_LIMIT = 200;

/** Tools whose calls write the file at their `path` (or name it in an `input` patch). */
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch"]);

/**
 * File names never served, whoever wrote them: environment files, keys and
 * certificates, credential stores, token files. Extend here.
 */
export const SENSITIVE_NAMES = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /^[._]?netrc$/i,
  /^\.(npmrc|pypirc|git-credentials|pgpass)$/i,
  /(^|[^a-z])(tokens?|secrets?|credentials?|passwords?)([^a-z]|$)/i,
];

/** Directories (as consecutive path segments) nothing is served from. Extend here. */
export const SENSITIVE_DIRS = [[".ssh"], [".aws"], [".gnupg"], [".kube"], [".docker"], [".azure"], [".config", "gh"], [".config", "gcloud"], [".omp-mobile"], [".git"]];

/** Characters of a path in prose: letters of any script, digits, and `_@+%=.~/-`. */
const PATH_RUN = /[\p{L}\p{N}_@+%=.~/-]+/gu;

function refusal(status, code, message, detail = {}) {
  return Object.assign(new Error(message), { status, detail: { code, ...detail } });
}

/** `raw` as an absolute, normalized path: `~/` is the home directory, anything relative is under `cwd`. */
function expand(raw, cwd) {
  const path = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (path === "" || path.includes("\0")) return undefined;
  if (path === "~" || (path.startsWith("~") && !path.startsWith("~/"))) return undefined;
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function under(path, dir) {
  return path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`);
}

/** Whether a path names a secret: a sensitive file name, or a file inside a sensitive directory. */
export function isSensitive(path) {
  const segments = path.split(sep).filter((segment) => segment !== "");
  const name = segments.at(-1) ?? "";
  if (SENSITIVE_NAMES.some((pattern) => pattern.test(name))) return true;
  const dirs = segments.slice(0, -1);
  return SENSITIVE_DIRS.some((run) => dirs.some((_, at) => run.every((segment, offset) => dirs[at + offset] === segment)));
}

/**
 * The paths a reply's text names that lie under `cwd`, in order: absolute,
 * relative or `~/` paths with a `/` or a file extension. URLs (their run
 * starts with `//`), directories (a trailing `/`) and bare words are not paths. Prose without spaces
 * (`已写入report.md`) also offers what follows its last non-ASCII character.
 * @param {string} text
 * @param {string} cwd
 */
export function mentionedPaths(text, cwd) {
  const root = resolve(cwd);
  const found = [];
  const seen = new Set();
  const offer = (token) => {
    if (token.startsWith("//") || token.endsWith("/") || !/\p{L}/u.test(token)) return;
    if (!token.includes("/") && !/\.[A-Za-z0-9]{1,8}$/.test(token)) return;
    const path = expand(token, root);
    if (path === undefined || !under(path, root) || path === root || seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };
  for (const match of text.matchAll(PATH_RUN)) {
    const token = match[0].replace(/\.+$/, "");
    offer(token);
    const tail = /^[^\x00-\x7f]/.test(token) ? /[^\x00-\x7f]([\x00-\x7f]+)$/.exec(token) : null;
    if (tail !== null && !tail[1].startsWith(".")) offer(tail[1]);
  }
  return found;
}

/** The files one write/edit tool call targets, as written (relative paths unresolved). */
function callTargets(name, args) {
  if (args === null || typeof args !== "object") return [];
  const targets = [];
  for (const key of ["path", "file_path"]) if (typeof args[key] === "string") targets.push(args[key]);
  if (typeof args.input === "string") {
    for (const line of args.input.split("\n")) {
      // Hashline edits: `[path#1A2B]` opens a file's section, `MV dest` renames it.
      const header = /^\[(.+)#[0-9A-Fa-f]{4}\]\s*$/.exec(line);
      if (header !== null) targets.push(header[1]);
      const move = /^MV\s+(.+?)\s*$/.exec(line);
      if (move !== null) targets.push(move[1]);
      // apply_patch: `*** Add File: path`, `*** Update File: path`, `*** Move to: path`.
      const patch = /^\*\*\* (?:Add File|Update File|Move to): (.+?)\s*$/.exec(line);
      if (patch !== null && name === "apply_patch") targets.push(patch[1]);
    }
  }
  return targets;
}

/**
 * Every file a session may hand over, oldest first by when it was last
 * written or named: path -> `written` (a write/edit call that succeeded) or
 * `mentioned` (named by a reply, under `cwd`). Nothing here touches the disk.
 * @param {readonly any[]} messages
 * @param {string} cwd
 * @returns {Map<string, "written" | "mentioned">}
 */
export function sessionFileCandidates(messages, cwd) {
  const root = resolve(cwd);
  /** @type {Map<string, "written" | "mentioned">} */
  const files = new Map();
  /** Write calls waiting for their result: id -> paths. */
  const pending = new Map();
  const note = (path, source) => {
    const before = files.get(path);
    files.delete(path);
    files.set(path, before === "written" ? "written" : source);
  };
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === "toolCall" && WRITE_TOOLS.has(part.name) && typeof part.id === "string") {
          const paths = callTargets(part.name, part.arguments).map((raw) => expand(raw, root)).filter((path) => path !== undefined);
          if (paths.length > 0) pending.set(part.id, paths);
        } else if (part?.type === "text" && typeof part.text === "string") {
          for (const path of mentionedPaths(part.text, root)) note(path, "mentioned");
        }
      }
    } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const paths = pending.get(message.toolCallId);
      pending.delete(message.toolCallId);
      if (paths !== undefined && message.isError !== true) for (const path of paths) note(path, "written");
    }
  }
  return files;
}

/**
 * Check that `path` (one of the candidates) may be served: not a secret, not a
 * symbolic link, and for a named file still under the session's directory once
 * links are resolved. Answers its `stat`, or throws the refusal.
 */
function inspect(path, source, cwd) {
  if (isSensitive(path)) throw refusal(403, "sensitive", "this file may hold secrets and is not served");
  let link;
  try {
    link = lstatSync(path);
  } catch {
    throw refusal(404, "gone", "the file no longer exists");
  }
  if (link.isSymbolicLink()) throw refusal(403, "outside_cwd", "the file is a symbolic link");
  const real = realpathSync(path);
  if (isSensitive(real)) throw refusal(403, "sensitive", "this file may hold secrets and is not served");
  if (source === "mentioned" && !under(real, realpathSync(cwd))) throw refusal(403, "outside_cwd", "the file lies outside the session's directory");
  const info = statSync(real);
  if (!info.isFile()) throw refusal(400, "not_file", "not a regular file");
  return info;
}

/**
 * What `GET /sessions/:id/files` answers: the files a session may hand over,
 * newest first. A written file that is gone stays, `exists: false`; a named
 * one that is not a servable file, and every refused one, is left out.
 */
export function listSessionFiles(messages, cwd) {
  const files = [];
  for (const [path, source] of [...sessionFileCandidates(messages, cwd)].reverse()) {
    if (files.length >= LIST_LIMIT) break;
    try {
      const info = inspect(path, source, cwd);
      files.push({ path, name: basename(path), source, exists: true, size: info.size, mtime: Math.round(info.mtimeMs) });
    } catch (error) {
      if (source === "written" && error?.detail?.code === "gone") files.push({ path, name: basename(path), source, exists: false });
    }
  }
  return { cwd: resolve(cwd), files };
}

/** `filename*` of a Content-Disposition: RFC 5987 percent-encoding. */
function dispositionName(name) {
  return encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Answer `GET /sessions/:id/file?path=`: the file's bytes, streamed, or a
 * refusal thrown as an error with `status` and `detail.code`.
 * @param {import("node:http").ServerResponse} res
 * @param {readonly any[]} messages the session's messages
 * @param {string} cwd the session's directory
 * @param {string | null} requested the absolute path asked for
 * @param {boolean} relayed through the relay, which holds the file in memory: the smaller cap
 */
export function sendSessionFile(res, messages, cwd, requested, relayed) {
  if (typeof requested !== "string" || !isAbsolute(requested) || requested.includes("\0") || normalize(requested) !== requested || requested.endsWith(sep)) {
    throw refusal(400, "bad_path", "path must be an absolute path without . or .. segments");
  }
  const source = sessionFileCandidates(messages, cwd).get(requested);
  if (source === undefined) throw refusal(403, "not_session_file", "this session did not write or name that file");
  const limit = relayed ? MAX_RELAY_FILE_BYTES : MAX_DIRECT_FILE_BYTES;
  const checked = inspect(requested, source, cwd);
  const tooLarge = (size) => refusal(413, "too_large", relayed ? "the file is too large for the relay" : "the file is too large", { limit, size, relay: relayed });
  // Opened without following a link, and checked again by descriptor: a swap after `inspect` is not served.
  let fd;
  try {
    fd = openSync(requested, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw refusal(404, "gone", "the file no longer exists");
  }
  const info = fstatSync(fd);
  if (!info.isFile() || info.ino !== checked.ino || info.dev !== checked.dev) {
    closeSync(fd);
    throw refusal(404, "gone", "the file changed while it was being opened");
  }
  if (info.size > limit) {
    closeSync(fd);
    throw tooLarge(info.size);
  }
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": info.size,
    "content-disposition": `attachment; filename*=UTF-8''${dispositionName(basename(requested))}`,
    "cache-control": "no-store",
  });
  if (info.size === 0) {
    closeSync(fd);
    res.end();
    return;
  }
  // Exactly the bytes the length announced, even if the file grows meanwhile.
  const stream = createReadStream("", { fd, start: 0, end: info.size - 1, autoClose: true });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
