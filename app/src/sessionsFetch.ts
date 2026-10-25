/**
 * One `GET /sessions` per computer at a time. Coming back to Home asks for the
 * list twice at once (the home's own refresh and the computer's probe); both
 * now share the request in flight and each reads the same answer.
 */

/** A `/sessions` answer, read once and shared: its status and its body as text. */
export interface SessionsAnswer {
  status: number;
  ok: boolean;
  text: string;
}

const inflight = new Map<string, Promise<SessionsAnswer>>();
/** A shared request is dropped after this long, so a link that went dead does not hold every later ask. */
const GIVE_UP_MS = 15_000;

/** Run `task` unless one for `key` is in flight, then share that one; the next call after it settles runs again. */
export function shared<T>(map: Map<string, Promise<T>>, key: string, task: () => Promise<T>): Promise<T> {
  const running = map.get(key);
  if (running !== undefined) return running;
  const run = task().finally(() => {
    if (map.get(key) === run) map.delete(key);
  });
  map.set(key, run);
  return run;
}

/** `GET <url>/sessions` with the token, shared with any such request already in flight. */
export function fetchSessions(url: string, token: string): Promise<SessionsAnswer> {
  return shared(inflight, `${url}\n${token}`, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GIVE_UP_MS);
    try {
      const response = await fetch(`${url}/sessions`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
      return { status: response.status, ok: response.ok, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  });
}
