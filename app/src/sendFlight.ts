import { useState } from "react";
import type { TextInput, View } from "react-native";
import {
  cancelAnimation,
  ReduceMotion,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";
import { EASE_OUT } from "./motion";

/**
 * A sent message travels from the composer's text field into its bubble in the
 * transcript: an overlay copy of the bubble starts over the typed text and springs
 * to the new row, which stays hidden until it lands. The overlay is always mounted;
 * it shows only once React has committed the copy's text (its layout reports in),
 * and springs only after that, so the copy is painted for the whole flight however
 * late the JS thread commits. Interrupted by the next send (the first lands at
 * once); skipped, for a plain fade, when the row cannot be measured in time or the
 * list is away from its newest end.
 */

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bubble a flight lands in: hidden (opacity 0) until the overlay hands over. */
export interface Landing {
  opacity: SharedValue<number>;
  rise: SharedValue<number>;
}

/** What the overlay draws from, in the overlay host's coordinates. */
export interface FlightValues {
  visible: SharedValue<number>;
  progress: SharedValue<number>;
  fromX: SharedValue<number>;
  fromY: SharedValue<number>;
  fromScale: SharedValue<number>;
  toX: SharedValue<number>;
  toY: SharedValue<number>;
}

export interface Shown {
  id: number;
  text: string;
}

/** Critically damped, about the screen spring's length; reduced motion never flies, so it is not consulted here. */
const SPRING: WithSpringConfig = { duration: 350, dampingRatio: 1, reduceMotion: ReduceMotion.Never };
const FADE: WithTimingConfig = { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
const REDUCED_FADE: WithTimingConfig = { duration: 150, easing: EASE_OUT, reduceMotion: ReduceMotion.Never };
/**
 * Longer than this before the copy is over the typed text and the flight would start
 * late: the row fades in instead. Once the copy holds the text where it was typed, the
 * wait reads as the message lifting off, so the row gets up to `PLACE_WITHIN` more to
 * report its place; its first layout varies from ~150 to ~400 ms on a busy JS thread.
 */
const MEASURE_WITHIN = 300;
const PLACE_WITHIN = 600;
const RISE = 8;

/** The composer field's text inset and type, and the bubble's (padding plus its 1 dp border), as styled. */
const INPUT_INSET = { x: 10, y: 6 };
const INPUT_LINE = 21;
const INPUT_FONT = 16;
const BUBBLE_INSET = { x: 17, y: 13 };
const BUBBLE_LINE = 22;
const BUBBLE_FONT = 15;

interface Current {
  id: number;
  text: string;
  reduced: boolean;
  origin?: Frame;
  host?: { x: number; y: number };
  /** The overlay committed this flight's text. */
  drawn: boolean;
  /** The overlay sits over the typed text (visible). */
  shown: boolean;
  frame?: Frame;
  landing?: Landing;
  started: boolean;
  /** The timeout was already extended once because the copy was showing. */
  extended?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

function usable(frame: Frame): boolean {
  return [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0;
}

function fadeIn(landing: Landing, reduced: boolean): void {
  cancelAnimation(landing.opacity);
  cancelAnimation(landing.rise);
  landing.rise.set(reduced ? 0 : RISE);
  if (!reduced) landing.rise.set(withTiming(0, FADE));
  landing.opacity.set(withTiming(1, reduced ? REDUCED_FADE : FADE));
}

export class SendFlight {
  /** The overlay's host view, set by `SendFlightLayer`. */
  host: View | null = null;
  /** Puts the copy's text in the overlay (set by `SendFlightLayer`). */
  listener: ((shown: Shown | null) => void) | null = null;
  reduced = false;
  private seq = 0;
  private current: Current | null = null;

  constructor(readonly values: FlightValues) {}

  /**
   * A message was just sent from `input`. `fly`: the list rests on its newest end, so
   * the row's place is known; otherwise the row plays its usual entrance.
   */
  launch(text: string, input: TextInput | null, fly: boolean): void {
    this.land();
    if (text === "" || (!fly && !this.reduced)) return;
    const current: Current = { id: ++this.seq, text, reduced: this.reduced, drawn: false, shown: false, started: false };
    this.current = current;
    current.timer = setTimeout(() => this.fallback(current), MEASURE_WITHIN);
    if (current.reduced || input === null || this.host === null || this.listener === null) return;
    this.listener({ id: current.id, text });
    input.measureInWindow((x, y, width, height) => {
      current.origin = { x, y, width, height };
      this.show(current);
    });
    this.host.measureInWindow((x, y) => {
      current.host = { x, y };
      this.show(current);
    });
  }

  /** The overlay laid out flight `id`'s text: it can be shown. */
  drawn(id: number): void {
    const current = this.current;
    if (current === null || current.id !== id) return;
    current.drawn = true;
    this.show(current);
  }

  /** Whether the row about to mount for `text` is this flight's landing (a pure check, safe during render). */
  wants(text: string): boolean {
    const current = this.current;
    return current !== null && !current.started && current.text === text;
  }

  /** The row registers the bubble it hides; a remount (strict mode) replaces it. Returns the flight's id. */
  claim(text: string, landing: Landing): number | undefined {
    const current = this.current;
    if (current === null || current.started || current.text !== text) return undefined;
    current.landing = landing;
    return current.id;
  }

  /** The claimed bubble is laid out at `frame` (window coordinates). */
  placed(id: number, frame: Frame | undefined): void {
    const current = this.current;
    if (current === null || current.id !== id || current.started || current.landing === undefined) return;
    if (current.reduced) {
      this.settle(current);
      fadeIn(current.landing, true);
      return;
    }
    if (frame === undefined || !usable(frame)) return;
    current.frame = frame;
    this.fly(current);
  }

  /** Ends the flight now: the bubble shows in place, the overlay goes. */
  land(): void {
    const current = this.current;
    if (current === null) return;
    this.settle(current);
    cancelAnimation(this.values.progress);
    cancelAnimation(this.values.visible);
    this.values.visible.set(0);
    const landing = current.landing;
    if (landing !== undefined) {
      cancelAnimation(landing.opacity);
      cancelAnimation(landing.rise);
      landing.opacity.set(1);
      landing.rise.set(0);
    }
  }

  private settle(current: Current): void {
    clearTimeout(current.timer);
    current.started = true;
    if (this.current === current) this.current = null;
  }

  /** The overlay over the typed text: scaled from the bubble's type to the field's, its first line on the field's. */
  private show(current: Current): void {
    const { origin, host } = current;
    if (this.current !== current || current.started || current.shown || !current.drawn || origin === undefined || host === undefined) return;
    if (!usable(origin)) return;
    current.shown = true;
    const values = this.values;
    const scale = INPUT_FONT / BUBBLE_FONT;
    const x = origin.x - host.x + INPUT_INSET.x - BUBBLE_INSET.x * scale;
    const y = origin.y - host.y + INPUT_INSET.y - BUBBLE_INSET.y * scale + (INPUT_LINE - BUBBLE_LINE * scale) / 2;
    cancelAnimation(values.progress);
    cancelAnimation(values.visible);
    values.fromX.set(x);
    values.fromY.set(y);
    values.fromScale.set(scale);
    values.toX.set(x);
    values.toY.set(y);
    values.progress.set(0);
    values.visible.set(1);
    // The row may be measured already: still give the copy one frame over the text before it leaves.
    requestAnimationFrame(() => this.fly(current));
  }

  private fly(current: Current): void {
    const { frame, landing, host } = current;
    if (this.current !== current || current.started || !current.shown || frame === undefined || landing === undefined || host === undefined) return;
    this.settle(current);
    const { progress, visible, toX, toY } = this.values;
    toX.set(frame.x - host.x);
    toY.set(frame.y - host.y);
    const opacity = landing.opacity;
    // Hand over in one UI frame: the bubble shows as the overlay goes, so nothing blinks.
    progress.set(
      withSpring(1, SPRING, (finished) => {
        "worklet";
        if (!finished) return;
        opacity.set(1);
        visible.set(0);
      }),
    );
  }

  /** Not ready in time: no flight; a copy already over the text fades away as the row fades in. */
  private fallback(current: Current): void {
    if (this.current !== current || current.started) return;
    if (current.shown && current.extended !== true) {
      current.extended = true;
      current.timer = setTimeout(() => this.fallback(current), PLACE_WITHIN);
      return;
    }
    this.settle(current);
    this.values.visible.set(current.shown ? withTiming(0, REDUCED_FADE) : 0);
    if (current.landing !== undefined) fadeIn(current.landing, current.reduced);
  }
}

/** One flight controller per chat screen. */
export function useSendFlight(): SendFlight {
  const values: FlightValues = {
    visible: useSharedValue(0),
    progress: useSharedValue(0),
    fromX: useSharedValue(0),
    fromY: useSharedValue(0),
    fromScale: useSharedValue(1),
    toX: useSharedValue(0),
    toY: useSharedValue(0),
  };
  const [flight] = useState(() => new SendFlight(values));
  flight.reduced = useReducedMotion();
  return flight;
}
