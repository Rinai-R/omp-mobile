/**
 * Choosing among the computers an account sign-in found.
 *
 * Kept apart from `pair.ts` so it can be tested without the app's native
 * modules: it is pure, and the sheet only renders what it decides.
 */

/** A computer found on the account, before the phone picks one. */
export interface RelayCandidate {
  deviceId: string;
  name: string;
  platform: string;
  online: boolean;
  /** Already in the phone's list: shown as disabled, not offered again. */
  added: boolean;
}

/**
 * What the sheet offers. Already-added computers stay in the list (dimmed) so the
 * account's computers are all visible; `pick` is what a one-computer sign-in
 * connects to without asking.
 */
export function relaySelection(candidates: readonly RelayCandidate[]): { pick: RelayCandidate | undefined; multiple: boolean } {
  const open = candidates.filter((item) => !item.added);
  const online = open.filter((item) => item.online);
  const preferred = online[0] ?? open[0];
  return { pick: open.length === 1 ? preferred : undefined, multiple: open.length > 1 };
}
