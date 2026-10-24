import { useMemo } from "react";
import { Easing, useColorScheme, type ColorSchemeName } from "react-native";

/**
 * OMP's design tokens, as omp.sh and my.omp.sh resolve them: near-black
 * surfaces first, a light scheme second. Surfaces step from `bg` up through
 * `panel`, `raised` and `overlay`; `inset` sits below them for code and tool
 * output, `well` is the fill of icon tiles and inputs. The brand gradient runs
 * magenta → violet → cyan (`accentA` → `accentV` → `accentB`) and is used
 * sparingly; `accent` is the solid magenta.
 */
export function palette(scheme: ColorSchemeName) {
  return scheme === "light"
    ? {
        dark: false,
        bg: "#f7f7f8",
        panel: "#ffffff",
        raised: "#ffffff",
        inset: "#f3f3f5",
        overlay: "#ffffff",
        well: "#f0f0f2",
        userBubble: "#ececf0",
        hover: "#00000008",
        selected: "#0000000f",
        fg: "#111114",
        fgMuted: "#3d3d44",
        fgFaint: "#6e6f77",
        fgGhost: "#a0a1a8",
        fgInverse: "#ffffff",
        accentA: "#d42ea3",
        accentV: "#7a45e0",
        accentB: "#0a9cb0",
        accent: "#d42ea3",
        accentFg: "#ffffff",
        accentMuted: "#d42ea31a",
        cyan: "#0a9cb0",
        ok: "#12a36b",
        okSoft: "#12a36b1a",
        warn: "#c77c02",
        warnSoft: "#c77c021a",
        err: "#dc3a40",
        errSoft: "#dc3a4014",
        errBorder: "#dc3a404d",
        border: "#0000000f",
        borderStrong: "#0000001c",
        edgeTop: "#0000001a",
        edgeBottom: "#0000000f",
        ring: "#0a9cb0",
        ringSoft: "#0a9cb029",
        backdrop: "#00000059",
      }
    : {
        dark: true,
        bg: "#000000",
        panel: "#0a0a0c",
        raised: "#121215",
        inset: "#060607",
        overlay: "#0f0f12",
        well: "#1a1a1f",
        userBubble: "#17171c",
        hover: "#ffffff0a",
        selected: "#ffffff14",
        fg: "#f5f5f5",
        fgMuted: "#c3c4c7",
        fgFaint: "#8a8b91",
        fgGhost: "#5d5e64",
        fgInverse: "#0a0a0b",
        accentA: "#f84fcc",
        accentV: "#9362f4",
        accentB: "#00dbe4",
        accent: "#f84fcc",
        accentFg: "#ffffff",
        accentMuted: "#f84fcc24",
        cyan: "#00dbe4",
        ok: "#3ecf8e",
        okSoft: "#3ecf8e1f",
        warn: "#f5a524",
        warnSoft: "#f5a5241f",
        err: "#ff6166",
        errSoft: "#ff61661f",
        errBorder: "#ff61664d",
        border: "#ffffff14",
        borderStrong: "#ffffff22",
        edgeTop: "#ffffff24",
        edgeBottom: "#ffffff0d",
        ring: "#00dbe4",
        ringSoft: "#00dbe42e",
        backdrop: "#000000a6",
      };
}

export type Palette = ReturnType<typeof palette>;

/** Corner radii: controls 10–12, cards 16, sheets and the composer 24. */
export const radius = { sm: 6, md: 10, lg: 14, xl: 18, xxl: 24, pill: 999 } as const;

/**
 * A component's style sheet for the current color scheme, built once per
 * scheme so style props keep their identity across renders.
 * @param create - builds the sheet from the palette; define it at module scope.
 */
export function useStyles<T>(create: (colors: Palette) => T): T {
  const scheme = useColorScheme();
  return useMemo(() => create(palette(scheme)), [create, scheme]);
}

export function useColors(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => palette(scheme), [scheme]);
}

/**
 * The bundled faces, registered as weight families: on Android an XML font
 * family (expo-font's `fontDefinitions`), on iOS by family name. Pair them with
 * `fontWeight` "400", "500" or "600"; nothing heavier is bundled.
 */
export const SANS = "Geist";
export const MONO = "JetBrains Mono";

/** The topbar height and the minimum touch target. */
export const HEADER_HEIGHT = 56;
export const HIT = 44;

/** `--ease-out: cubic-bezier(.16,1,.3,1)`: fast out, long settle. */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** The brand gradient's direction: top-left to bottom-right, as the π mark draws it. */
export const GRADIENT = { x1: "0", y1: "0", x2: "1", y2: "1" } as const;

export const type = {
  display: { fontFamily: SANS, fontSize: 28, lineHeight: 34, fontWeight: "600" as const, letterSpacing: -0.8 },
  title: { fontFamily: SANS, fontSize: 20, lineHeight: 26, fontWeight: "600" as const, letterSpacing: -0.4 },
  heading: { fontFamily: SANS, fontSize: 16, lineHeight: 21, fontWeight: "600" as const, letterSpacing: -0.2 },
  body: { fontFamily: SANS, fontSize: 15, lineHeight: 23, fontWeight: "400" as const },
  bodyMedium: { fontFamily: SANS, fontSize: 15, lineHeight: 21, fontWeight: "500" as const },
  small: { fontFamily: SANS, fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  /** Metadata: paths, models, times. */
  mono: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16, fontWeight: "400" as const },
  /** Code and tool output. */
  code: { fontFamily: MONO, fontSize: 12, lineHeight: 18, fontWeight: "400" as const },
  /** Uppercase section labels with wide tracking, as omp.sh sets them. */
  label: {
    fontFamily: MONO,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: "500" as const,
    letterSpacing: 1.6,
    textTransform: "uppercase" as const,
  },
} as const;
