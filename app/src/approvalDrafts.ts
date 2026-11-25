import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { moveAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { approvalIdentity, type ApprovalDraft } from "./approvalForms";
import type { ApprovalRequest } from "./types";

const ROOT = new Directory(Paths.document, "approval-drafts");
const MAX_AGE = 24 * 60 * 60_000;
const retired = new Set<string>();
const writes = new Map<string, Promise<void>>();
let pruning: Promise<void> | undefined;
const identity = (machine: string, session: string, request: ApprovalRequest) =>
  `${machine}\n${session}\n${approvalIdentity(request)}`;
const key = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const file = (name: string) => new File(ROOT, `${name}.json`);

// Resolution must run after a pending save, and prevent the sheet's unmount from recreating it.
function enqueue<T>(name: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(name) ?? Promise.resolve())
    .catch(() => {})
    .then(work);
  const done = next.then(
    () => {},
    () => {},
  );
  writes.set(name, done);
  void done.then(() => {
    if (writes.get(name) === done) writes.delete(name);
  });
  return next;
}
function prune() {
  pruning ??= (async () => {
    if (!ROOT.exists) return;
    await Promise.all(
      ROOT.list().map((entry) =>
        enqueue(entry.name.replace(/\.(json|tmp)$/, ""), async () => {
          try {
            if (entry instanceof File && entry.name.endsWith(".json")) {
              const saved = JSON.parse(await entry.text());
              if (Number.isFinite(saved.at) && Date.now() - saved.at <= MAX_AGE)
                return;
            }
          } catch {}
          if (entry.exists) entry.delete();
        }),
      ),
    );
  })().catch(() => {});
  return pruning;
}
function validDraft(draft: unknown): draft is ApprovalDraft {
  if (!draft || typeof draft !== "object") return false;
  const d = draft as Partial<ApprovalDraft>;
  return (
    typeof d.text === "string" &&
    ["values", "checked", "others", "usingOther"].every((name) => {
      const value = (d as Record<string, unknown>)[name];
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    }) &&
    Object.values(d.checked!).every(
      (v) => Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0),
    ) &&
    Object.values(d.others!).every((v) => typeof v === "string") &&
    Object.values(d.usingOther!).every((v) => typeof v === "boolean") &&
    Object.values(d.values!).every(
      (v) =>
        typeof v === "string" ||
        (typeof v === "number" && Number.isFinite(v)) ||
        (Array.isArray(v) && v.every((s) => typeof s === "string")),
    )
  );
}
export async function loadApprovalDraft(
  machine: string,
  session: string,
  request: ApprovalRequest,
): Promise<ApprovalDraft | undefined> {
  await prune();
  const name = identity(machine, session, request);
  if (retired.has(name)) return;
  const k = await key(name);
  await writes.get(k);
  try {
    const saved = JSON.parse(await file(k).text());
    if (
      Number.isFinite(saved.at) &&
      Date.now() - saved.at <= MAX_AGE &&
      validDraft(saved.draft)
    )
      return saved.draft;
  } catch {}
}
export async function saveApprovalDraft(
  machine: string,
  session: string,
  request: ApprovalRequest,
  draft: ApprovalDraft,
) {
  const name = identity(machine, session, request);
  if (retired.has(name)) return;
  const k = await key(name);
  await enqueue(k, async () => {
    if (retired.has(name)) return;
    ROOT.create({ intermediates: true, idempotent: true });
    const temp = new File(ROOT, `${k}.tmp`);
    await writeAsStringAsync(
      temp.uri,
      JSON.stringify({ at: Date.now(), draft }),
    );
    await moveAsync({ from: temp.uri, to: file(k).uri });
  });
}
export async function forgetApprovalDraft(
  machine: string,
  session: string,
  request: ApprovalRequest,
) {
  const name = identity(machine, session, request);
  retired.add(name);
  const k = await key(name);
  await enqueue(k, async () => {
    const saved = file(k);
    if (saved.exists) saved.delete();
  });
}
