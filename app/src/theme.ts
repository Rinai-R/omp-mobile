import { useMemo } from "react";
import { Easing, Platform, StyleSheet, useColorScheme, type ColorSchemeName } from "react-native";

/**
 * OMP's design tokens, as my.omp.sh resolves them: a near-black dark scheme
 * first, a light one from `[data-theme=light]`. Surfaces step from `bg` up
 * through `panel`, `raised` and `overlay`; `inset` sits below them for code and
 * tool output. The cyan → pink gradient (`accentA` → `accentB`) is the brand
 * mark and is used sparingly; `accent` is the solid primary.
 */
export function palette(scheme: ColorSchemeName) {
  return scheme === "light"
    ? {
        dark: false,
        bg: "#f2f2f3",
        panel: "#ffffff",
        raised: "#ffffff",
        inset: "#f6f6f7",
        overlay: "#ffffff",
        hover: "#00000008",
        selected: "#0000000f",
        fg: "#151518",
        fgMuted: "#5a5a63",
        fgFaint: "#8b8b94",
        fgInverse: "#ffffff",
        accentA: "#1fa9bb",
        accentB: "#d42ea3",
        accent: "#c42596",
        accentFg: "#ffffff",
        accentMuted: "#d42ea31a",
        ok: "#12a36b",
        okSoft: "#12a36b1a",
        warn: "#c77c02",
        warnSoft: "#c77c021a",
        err: "#dc3a40",
        errSoft: "#dc3a4014",
        errBorder: "#dc3a404d",
        border: "#00000014",
        borderStrong: "#00000024",
        edgeTop: "#0000001a",
        edgeBottom: "#0000000f",
        ring: "#1fa9bb",
        ringSoft: "#1fa9bb29",
        backdrop: "#00000040",
      }
    : {
        dark: true,
        bg: "#000000",
        panel: "#09090a",
        raised: "#0e0e10",
        inset: "#060607",
        overlay: "#17171a",
        hover: "#ffffff09",
        selected: "#ffffff13",
        fg: "#ededef",
        fgMuted: "#a0a0a8",
        fgFaint: "#6c6c74",
        fgInverse: "#0a0a0b",
        accentA: "#5ad8e6",
        accentB: "#ed4abf",
        accent: "#f068c8",
        accentFg: "#ffffff",
        accentMuted: "#ed4abf24",
        ok: "#3ecf8e",
        okSoft: "#3ecf8e1f",
        warn: "#f5a524",
        warnSoft: "#f5a5241f",
        err: "#ff6166",
        errSoft: "#ff61661f",
        errBorder: "#ff61664d",
        border: "#ffffff12",
        borderStrong: "#ffffff21",
        edgeTop: "#ffffff24",
        edgeBottom: "#ffffff0d",
        ring: "#5ad8e6",
        ringSoft: "#5ad8e62e",
        backdrop: "#0000008c",
      };
}

export type Palette = ReturnType<typeof palette>;

/** my.omp.sh radii: sm 6, md 8, lg 12, xl 16. */
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/**
 * A component's style sheet for the current color scheme, built once per
 * scheme so style props keep their identity across renders.
 * @param create - builds the sheet from the palette; define it at module scope.
 */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(create: (colors: Palette) => T): T {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(create(palette(scheme))), [create, scheme]);
}

export function useColors(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => palette(scheme), [scheme]);
}

/** The platform's terminal face: `ui-monospace` resolves to Menlo on iOS, the system mono elsewhere. */
export const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** The topbar height (my.omp.sh `--topbar-h`) and the minimum touch target. */
export const HEADER_HEIGHT = 52;
export const HIT = 44;

/** `--ease-out: cubic-bezier(.16,1,.3,1)`: fast out, long settle. */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** The brand gradient runs at 100deg: left to right, slightly downhill. */
export const GRADIENT = { x1: "0", y1: "0.41", x2: "1", y2: "0.59" } as const;

export const type = {
  title: { fontSize: 22, fontWeight: "600" as const, letterSpacing: -0.4 },
  heading: { fontSize: 15, fontWeight: "600" as const, letterSpacing: -0.15 },
  body: { fontSize: 15, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11 },
  mono: { fontFamily: MONO, fontSize: 11.5, lineHeight: 17 },
} as const;
