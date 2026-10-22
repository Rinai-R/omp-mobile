import { useMemo } from "react";
import { Platform, StyleSheet, useColorScheme, type ColorSchemeName } from "react-native";

/** The same resolved dsh tokens Kivotos uses, plus a chat surface. */
export function palette(scheme: ColorSchemeName) {
  return scheme === "dark"
    ? {
        bg: "#151517",
        surface: "#1B1B1C",
        raised: "#232326",
        pressed: "#2C2C2E",
        separator: "rgba(255,255,255,0.06)",
        border: "rgba(255,255,255,0.12)",
        text: "#F9FAFB",
        textSecondary: "#CFD3D6",
        textTertiary: "#ADB2B8",
        primary: "#F9FAFB",
        onPrimary: "#151517",
        link: "#7AAAFF",
        danger: "#F25A5A",
        dangerSoft: "rgba(242,90,90,0.12)",
        success: "#22C55E",
        successSoft: "rgba(34,197,94,0.12)",
        warn: "#F59E0B",
        warnSoft: "rgba(245,158,11,0.12)",
        scrim: "rgba(0,0,0,0.55)",
        userBubble: "#2A3A56",
        assistantBubble: "#1B1B1C",
        code: "#111113",
      }
    : {
        bg: "#FFFFFF",
        surface: "#F9FAFB",
        raised: "#EEF1F5",
        pressed: "#EBEEF2",
        separator: "rgba(0,0,0,0.04)",
        border: "rgba(0,0,0,0.1)",
        text: "#0F1115",
        textSecondary: "#61666B",
        textTertiary: "#81858C",
        primary: "#0F1115",
        onPrimary: "#FFFFFF",
        link: "#4176E6",
        danger: "#EC1313",
        dangerSoft: "#FEF2F2",
        success: "#22C55E",
        successSoft: "rgba(34,197,94,0.12)",
        warn: "#F59E0B",
        warnSoft: "rgba(245,158,11,0.12)",
        scrim: "rgba(15,17,21,0.45)",
        userBubble: "#DCE8FF",
        assistantBubble: "#F4F6F9",
        code: "#F1F3F6",
      };
}

export type Palette = ReturnType<typeof palette>;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

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

export const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** Header height and the minimum touch target. */
export const HEADER_HEIGHT = 56;
export const HIT = 44;

export const type = {
  title: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13 },
  tiny: { fontSize: 11 },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 17 },
} as const;
