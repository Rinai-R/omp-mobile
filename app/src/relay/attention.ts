/**
 * Background notifications for computers paired through a relay: the app
 * follows each one's `/events` stream through the relay and hands the frames
 * to the notification service (`modules/omp-attention`), which posts them as
 * it does for the tailnet streams it follows itself. Its foreground service
 * keeps this process, and with it these streams, alive in the background.
 */
import * as Attention from "../../modules/omp-attention/src";
import type { Machine } from "../types";
import { sseParser } from "./sse.ts";
import { relayStream } from "./tunnel";

const MAX_BACKOFF_MS = 60_000;

/** Follow every relay machine's events until the returned function is called. */
export function followRelayEvents(machines: readonly Machine[]): () => void {
  const stop = new AbortController();
  for (const machine of machines) {
    const relay = machine.relay;
    if (relay === undefined) continue;
    void (async () => {
      let backoff = 1_000;
      while (!stop.signal.aborted) {
        let reached = false;
        try {
          await relayStream(
            relay,
            "/events",
            {
              onOpen: () => {
                reached = true;
                Attention.setRelayConnected(machine.id, true);
              },
              onText: sseParser((frame) => Attention.deliverRelay(machine.id, frame)),
            },
            stop.signal,
          );
        } catch {
          // Offline, the computer asleep, the relay restarting: retry below.
        }
        Attention.setRelayConnected(machine.id, false);
        if (stop.signal.aborted) return;
        if (reached) backoff = 1_000;
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    })();
  }
  return () => stop.abort();
}
