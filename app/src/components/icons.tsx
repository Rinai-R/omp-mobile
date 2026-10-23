import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/** OMP line icons: thin 1.5 px strokes, round caps, one color each. */
interface GlyphProps {
  size?: number;
  color: string;
}

const STROKE = {
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function BackGlyph({ size = 22, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path d="M12.5 4.5L7 10l5.5 5.5" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function ChevronGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M6 3.5L10.5 8 6 12.5" stroke={color} {...STROKE} strokeWidth={1.5} />
    </Svg>
  );
}

export function ChevronDownGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M3.5 6L8 10.5 12.5 6" stroke={color} {...STROKE} strokeWidth={1.5} />
    </Svg>
  );
}

export function PlusGlyph({ size = 22, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path d="M10 4v12M4 10h12" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function CloseGlyph({ size = 18, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke={color} {...STROKE} />
    </Svg>
  );
}

export function SettingsGlyph({ size = 22, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0l.1.6a1.7 1.7 0 0 0 2.5 1l.5-.3a1.7 1.7 0 0 1 2.4 2.4l-.3.5a1.7 1.7 0 0 0 1 2.5l.6.1a1.7 1.7 0 0 1 0 3.4l-.6.1a1.7 1.7 0 0 0-1 2.5l.3.5a1.7 1.7 0 0 1-2.4 2.4l-.5-.3a1.7 1.7 0 0 0-2.5 1l-.1.6a1.7 1.7 0 0 1-3.4 0l-.1-.6a1.7 1.7 0 0 0-2.5-1l-.5.3a1.7 1.7 0 0 1-2.4-2.4l.3-.5a1.7 1.7 0 0 0-1-2.5l-.6-.1a1.7 1.7 0 0 1 0-3.4l.6-.1a1.7 1.7 0 0 0 1-2.5l-.3-.5a1.7 1.7 0 0 1 2.4-2.4l.5.3a1.7 1.7 0 0 0 2.5-1l.1-.6Z"
        stroke={color}
        {...STROKE}
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function SendGlyph({ size = 18, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path d="M10 16V4M5 9l5-5 5 5" stroke={color} {...STROKE} strokeWidth={2} />
    </Svg>
  );
}

export function StopGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14">
      <Rect x={1} y={1} width={12} height={12} rx={2.5} fill={color} />
    </Svg>
  );
}

export function ToolGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M12.6 3.3a4 4 0 0 0-4.9 5.2l-4.3 4.3a1.6 1.6 0 0 0 2.3 2.3l4.3-4.3a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.1-.5-.5-2.1 2.4-2.4Z"
        stroke={color}
        {...STROKE}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

export function ComputerGlyph({ size = 20, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={2.5} y={3.5} width={15} height={10} rx={2} stroke={color} strokeWidth={1.5} />
      <Path d="M7 16.5h6M10 13.5v3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function ChatGlyph({ size = 20, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z"
        stroke={color}
        {...STROKE}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

export function QrGlyph({ size = 20, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={3} y={3} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Rect x={11.5} y={3} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Rect x={3} y={11.5} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Path d="M11.5 11.5h2v2M17 11.5v2M11.5 17h2.5M17 15.5V17" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function KeyboardGlyph({ size = 18, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={2} y={5} width={16} height={10} rx={2} stroke={color} strokeWidth={1.5} />
      <Path d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 12h7" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function CheckGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M3 8.5l3.5 3.5L13 4.5" stroke={color} {...STROKE} strokeWidth={1.8} />
    </Svg>
  );
}
