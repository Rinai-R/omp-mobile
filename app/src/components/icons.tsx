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

/** One glyph per tool kind, on a 24-unit grid. */
export function FileGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" stroke={color} {...STROKE} strokeWidth={1.8} />
    </Svg>
  );
}

export function PencilGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4" stroke={color} {...STROKE} strokeWidth={1.8} />
    </Svg>
  );
}

export function TerminalGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 7l5 5-5 5M12 17h7" stroke={color} {...STROKE} strokeWidth={1.9} />
    </Svg>
  );
}

export function SearchGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6} stroke={color} strokeWidth={1.8} />
      <Path d="M20 20l-4.3-4.3" stroke={color} {...STROKE} strokeWidth={1.8} />
    </Svg>
  );
}

export function GlobeGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.7} />
      <Path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5S9.5 6.1 12 3.5Z" stroke={color} {...STROKE} strokeWidth={1.5} />
    </Svg>
  );
}

export function ListGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke={color} {...STROKE} strokeWidth={2} />
    </Svg>
  );
}

export function AgentsGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3.2} stroke={color} strokeWidth={1.7} />
      <Path d="M3.5 19c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5M15.5 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.3c1.6.7 2.6 2.3 3 4.7" stroke={color} {...STROKE} strokeWidth={1.7} />
    </Svg>
  );
}

export function QuestionGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.7} />
      <Path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.6M12 17h.01" stroke={color} {...STROKE} strokeWidth={1.8} />
    </Svg>
  );
}

export function SparkGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" stroke={color} {...STROKE} strokeWidth={1.5} />
    </Svg>
  );
}

export function ImageGlyph({ size = 18, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={4.5} width={17} height={15} rx={3} stroke={color} strokeWidth={1.7} />
      <Circle cx={9} cy={10} r={1.7} stroke={color} strokeWidth={1.6} />
      <Path d="M4 17l4.5-4 3.5 3 3-2.5 5 4" stroke={color} {...STROKE} strokeWidth={1.6} />
    </Svg>
  );
}

export function CameraGlyph({ size = 18, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" stroke={color} {...STROKE} strokeWidth={1.7} />
      <Circle cx={12} cy={12.5} r={3.3} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

export function MoreGlyph({ size = 20, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={19} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

export function LockGlyph({ size = 12, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={11} width={14} height={9} rx={2} stroke={color} strokeWidth={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} {...STROKE} strokeWidth={2} />
    </Svg>
  );
}

export function WarningGlyph({ size = 22, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5l9 16H3z M12 10v4M12 17.2v.01" stroke={color} {...STROKE} strokeWidth={1.9} />
    </Svg>
  );
}

export function ArrowDownGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M6 13l6 6 6-6" stroke={color} {...STROKE} strokeWidth={2.1} />
    </Svg>
  );
}

export function CopyGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={8} y={8} width={12} height={12} rx={2.5} stroke={color} strokeWidth={1.7} />
      <Path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" stroke={color} {...STROKE} strokeWidth={1.7} />
    </Svg>
  );
}

/** Thinking: an atom, two crossed orbits around a core. */
export function ThinkGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5.6 5.6c2.2-2.2 7.6.2 10.6 3.2s5.4 8.4 3.2 10.6-7.6-.2-10.6-3.2S3.4 7.8 5.6 5.6z" stroke={color} strokeWidth={1.5} />
      <Path d="M18.4 5.6c2.2 2.2-.2 7.6-3.2 10.6s-8.4 5.4-10.6 3.2.2-7.6 3.2-10.6 8.4-5.4 10.6-3.2z" stroke={color} strokeWidth={1.5} />
      <Circle cx={12} cy={12} r={1.6} fill={color} />
    </Svg>
  );
}

/** Soft wrap: a line that runs to the edge and returns under itself. */
export function WrapGlyph({ size = 14, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16M4 12h12.5a3.5 3.5 0 0 1 0 7H12M14 16.5L11.5 19l2.5 2.5M4 18h4" stroke={color} {...STROKE} strokeWidth={1.7} />
    </Svg>
  );
}

/** Pointing up: a chevron for something open that folds. */
export function ChevronUpGlyph({ size = 16, color }: GlyphProps): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M3.5 10L8 5.5 12.5 10" stroke={color} {...STROKE} strokeWidth={1.5} />
    </Svg>
  );
}
