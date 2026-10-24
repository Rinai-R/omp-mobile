/**
 * Taking a session over from the omp process on the computer that holds it
 * (issue #28): what the phone says about that process, and when it offers to.
 * Its text is the `chat.takeover.*` keys of the catalogs.
 */
import { t } from "./i18n/index.ts";
import type { SessionOwner } from "./types";

/** The daemon feature that offers `POST /sessions/:id/takeover`. */
export const TAKEOVER_FEATURE = "takeover";

/** Whether the phone can offer to take a held session over: the daemon says it can, and the session is held (409). */
export function canTakeOver(status: number, features: readonly string[]): boolean {
  return status === 409 && features.includes(TAKEOVER_FEATURE);
}

/** The card's one line for a held session. */
export function heldLine(owner: SessionOwner | undefined): string {
  return owner?.busy === true ? t("chat.takeover.heldBusy") : t("chat.takeover.held");
}

/** The confirmation's message: a turn in progress is said to stop. */
export function confirmBody(owner: SessionOwner | undefined): string {
  return owner?.busy === true ? t("chat.takeover.confirmBusy") : t("chat.takeover.confirm");
}

/** A session row's note for a held session. */
export function heldDetail(owner: SessionOwner | undefined): string {
  return owner?.busy === true ? t("session.workingInTerminal") : t("session.inTerminal");
}

/** The owner a daemon reported, if the value is one. */
export function ownerOf(value: unknown): SessionOwner | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { pid, busy, terminal } = value as Record<string, unknown>;
  if (typeof pid !== "number") return undefined;
  return { pid, busy: busy === true, terminal: terminal === true };
}
