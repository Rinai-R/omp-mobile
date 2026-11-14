import { useMemo } from "react";
import { Easing, useColorScheme, type ColorSchemeName } from "react-native";

/**
 * OMP's design tokens, as omp.sh and my.omp.sh resolve them: near-black
 * surfaces first, a light scheme second. Surfaces step from `bg` up through
 * `panel`, `raised` and `overlay`; `inset` sits below them for code and tool
 * output, `well` is the fill of icon tiles and inputs. The brand gradient runs
 * magenta → violet → cyan (`accentA` → `accentV` → `accentB`) and is used
 * sparingly; `accent` is the solid magenta. `codeBg`, `codeHead` and
 * `inlineCode` tint code in replies: a block, its header, a span in prose.
 *
 * The iOS-flavoured layer on top: `group` rows on `bg` with `separator`
 * hairlines, `tint` for links and the back button, `search`/`segment` fills,
 * the user's bubble gradient (`userA` → `userB`), the reply's translucent
 * `bubble`, tool `card`s with violet `tile`s, the approval widget gradient
 * (`widgetA` → `widgetB` → `widgetC`), the New button (`fab`), and the system
 * colours (`sysRed`, `sysGreen`, `sysBlue`, `sysOrange`, `sysYellow`).
 */
export function palette(scheme: ColorSchemeName) {
  return scheme === "light"
    ? {
        dark: false,
        bg: "#f2f2f7",
        panel: "#ffffff",
        raised: "#ffffff",
        inset: "#f3f3f5",
        overlay: "#ffffff",
        well: "#f0f0f2",
        userBubble: "#eaedfa",
        codeBg: "#ffffff",
        codeHead: "#ebebef",
        inlineCode: "#00000009",
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
        group: "#ffffff",
        separator: "#c6c6c8",
        tint: "#9b3fd1",
        search: "#7676801f",
        segment: "#ffffff",
        userA: "#f8e1f3",
        userB: "#e0e6fb",
        userBorder: "#0000000a",
        bubble: "#ffffff",
        bubbleBorder: "#0000000d",
        card: "#ffffff",
        tile: "#7a45e01a",
        tileFg: "#7a45e0",
        term: "#111318",
        termFg: "#b8f5d7",
        widgetA: "#fbe3f5",
        widgetB: "#e9e3fd",
        widgetC: "#dcf3f8",
        widgetButton: "#ffffffb3",
        fab: "#111114",
        fabFg: "#ffffff",
        badge: "#ff2d55",
        sysRed: "#ff3b30",
        sysGreen: "#34c759",
        sysBlue: "#007aff",
        sysOrange: "#ff9500",
        sysYellow: "#b88400",
        chrome: "#f9f9f9e6",
      }
    : {
        dark: true,
        bg: "#000000",
        panel: "#0a0a0c",
        raised: "#121215",
        inset: "#060607",
        overlay: "#0f0f12",
        well: "#1a1a1f",
        userBubble: "#1f1f25",
        codeBg: "#111114",
        codeHead: "#16161b",
        inlineCode: "#ffffff10",
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
        group: "#1c1c1e",
        separator: "#38383a",
        tint: "#e08dff",
        search: "#ffffff14",
        segment: "#636366",
        userA: "#3a1d4a",
        userB: "#1a2448",
        userBorder: "#ffffff1f",
        bubble: "#ffffff0b",
        bubbleBorder: "#ffffff12",
        card: "#ffffff08",
        tile: "#8b5cf622",
        tileFg: "#c4b5fd",
        term: "#05080a",
        termFg: "#b8f5d7",
        widgetA: "#3a1748",
        widgetB: "#1e1a52",
        widgetC: "#0c2c3a",
        widgetButton: "#ffffff26",
        fab: "#f5f5f7",
        fabFg: "#000000",
        badge: "#ff375f",
        sysRed: "#ff453a",
        sysGreen: "#30d158",
        sysBlue: "#0a84ff",
        sysOrange: "#ff9f0a",
        sysYellow: "#ffd60a",
        chrome: "#121214e6",
      };
}

export type Palette = ReturnType<typeof palette>;

/** Corner radii: inline code and icon buttons 8, images 12, code and cards 16, the user's bubble 20, sheets 28. */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 } as const;

/**
 * How far each kind of text follows the system font size
 * (`maxFontSizeMultiplier`): prose a long way, headings and meta less, code
 * least, where width matters most. Line heights scale with the size up to
 * the same cap, so large text does not clip.
 */
export const SCALE = { body: 1.35, heading: 1.2, meta: 1.25, table: 1.2, code: 1.15, ui: 1.1 } as const;

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
/** JetBrains Mono NL, the cut without ligatures: code shows `=>` and `!=` as typed. */
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
