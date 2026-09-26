import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * The canvas's glyphs as vector paths. Every entry below is copied from the board SVG that draws it (24-unit
 * viewBox, `fill="none"`, `stroke="currentColor"`, `stroke-linecap="round"`), with the board's stroke width and
 * line join, so an icon here is the board's icon, not a redrawing of it. Nothing is approximated: arcs, rounded
 * corners and joins are the SVG's own.
 */

type Shape =
  | { k: 'path'; d: string }
  | { k: 'circle'; cx: number; cy: number; r: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; rx: number };

interface Glyph {
  /** `stroke-width` as the boards draw this glyph (24-unit viewBox). */
  stroke: number;
  /** `stroke-linejoin` as drawn: `round` on most glyphs; the boards leave it at the default (miter) on a few. */
  join: 'round' | 'miter';
  /** A filled glyph with no stroke (the share sheet's "More"). */
  filled?: boolean;
  shapes: readonly Shape[];
}

const path = (d: string): Shape => ({ k: 'path', d });
const circle = (cx: number, cy: number, r: number): Shape => ({ k: 'circle', cx, cy, r });
const rect = (x: number, y: number, w: number, h: number, rx: number): Shape => ({
  k: 'rect',
  x,
  y,
  w,
  h,
  rx,
});

const GEAR =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z';

/** Board glyphs, keyed by name. The comment names the board(s) and the size(s) they are drawn at. */
const ICONS = {
  /** Back buttons, every nav bar · 24. */
  chevronLeft: { stroke: 2.2, join: 'round', shapes: [path('M15 5l-7 7 7 7')] },
  /** Settle rows, settings rows, the Split row · 16. */
  chevronRight: { stroke: 2.4, join: 'round', shapes: [path('M9 5l7 7-7 7')] },
  /** Select pills (Add expense), "Archived · 2" · 14. */
  chevronDown: { stroke: 2.6, join: 'round', shapes: [path('M6 9l6 6 6-6')] },
  /** "Add expense" 20, "Add member" 16 (stroke 2.4); the add-a-name button 16 and a stepper 12 draw it at 2.6. */
  plus: { stroke: 2.4, join: 'miter', shapes: [path('M12 5v14M5 12h14')] },
  /** The shares stepper (Split, equal) · 12. */
  minus: { stroke: 2.6, join: 'miter', shapes: [path('M5 12h14')] },
  /** A sheet's close button 12, a member chip's remove button 10. */
  close: { stroke: 3, join: 'miter', shapes: [path('M6 6l12 12M18 6L6 18')] },
  /** "You're even" 16 (2.6); the joined / done mark 12 and 13 draw it at 2.8. */
  check: { stroke: 2.6, join: 'round', shapes: [path('M5 12.5l4.5 4.5L19 7.5')] },
  /** Settle ("You pay Maya →"), the "moved" banner · 20. */
  arrowRight: { stroke: 2, join: 'round', shapes: [path('M5 12h14'), path('M13 6l6 6-6 6')] },
  /** The sync button on Group and the not-synced line · 16. */
  sync: {
    stroke: 2,
    join: 'round',
    shapes: [
      path('M20 12a8 8 0 0 1-13.7 5.6'),
      path('M4 12a8 8 0 0 1 13.7-5.6'),
      path('M17.7 2.6v4h-4'),
      path('M6.3 21.4v-4h4'),
    ],
  },
  /** The "couldn't be read" banner (Group · dark) · 20. */
  info: {
    stroke: 2,
    join: 'miter',
    shapes: [circle(12, 12, 9), path('M12 11v5'), path('M12 7.6v.4')],
  },
  /** The "update required" banner (States) · 20. */
  update: {
    stroke: 2,
    join: 'round',
    shapes: [circle(12, 12, 9), path('M12 16V8'), path('M8.5 11.5L12 8l3.5 3.5')],
  },
  /** The "group closed" banner (States) 20; the server line on Join 13 (stroke 2.2). */
  lock: {
    stroke: 2,
    join: 'round',
    shapes: [rect(5, 11, 14, 10, 2), path('M8 11V8a4 4 0 0 1 8 0v3')],
  },
  /** "Archived · 2" 18, the archived banner and Group settings' Archive row 20. */
  archive: {
    stroke: 2,
    join: 'round',
    shapes: [
      rect(3, 4, 18, 5, 1.5),
      path('M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9'),
      path('M10 13h4'),
    ],
  },
  /** Settings beside a large title 24, group settings in a nav bar 22. */
  gear: { stroke: 1.8, join: 'round', shapes: [circle(12, 12, 3), path(GEAR)] },
  /** "Share invite" in Group's nav bar · 22. */
  share: {
    stroke: 2,
    join: 'round',
    shapes: [
      path('M12 3v12'),
      path('M8 7l4-4 4 4'),
      path('M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1'),
    ],
  },
  /** The emoji picker's search field · 18. */
  search: { stroke: 2.2, join: 'miter', shapes: [circle(11, 11, 6.5), path('M16 16l4.5 4.5')] },
  /** "on this phone" in Activity · 12. */
  device: { stroke: 2.2, join: 'round', shapes: [rect(7, 2.5, 10, 19, 2.5), path('M11 18.5h2')] },
  /** The avatar's edit badge (App settings, Create group) · 12. */
  pencil: { stroke: 3, join: 'round', shapes: [path('M4 20l4-1 11-11-3-3L5 16z')] },
  /** The keypad's delete key · 26. */
  backspace: {
    stroke: 1.8,
    join: 'round',
    shapes: [
      path('M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z'),
      path('M12.5 9.5l5 5M17.5 9.5l-5 5'),
    ],
  },
  /** The Paste button on Join with code · 16. */
  paste: {
    stroke: 2,
    join: 'round',
    shapes: [
      rect(7, 4, 10, 4, 1.5),
      path('M7 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1'),
    ],
  },
  /** An unreadable code 20 (JoinCodeError); a field error 16 at stroke 2.2 (States). */
  warning: {
    stroke: 2,
    join: 'round',
    shapes: [
      path('M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z'),
      path('M12 9.5v4.5'),
      path('M12 17.2v.3'),
    ],
  },
  /** "Import group file" (Groups 18, App settings 20). */
  import: {
    stroke: 2,
    join: 'round',
    shapes: [
      path('M12 4v10'),
      path('M8 10l4 4 4-4'),
      path('M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'),
    ],
  },
  /** "Anyone with this link…" (Group settings) · 18. */
  key: {
    stroke: 2,
    join: 'round',
    shapes: [circle(7.5, 15.5, 4.5), path('M10.7 12.3L20 3'), path('M16 7l3 3')],
  },
  /** "Regenerate invite link" (Group settings) · 20. */
  regenerate: {
    stroke: 2,
    join: 'round',
    shapes: [path('M20 11a8 8 0 1 0-2.3 5.7'), path('M20 5v6h-6')],
  },
  /** "Leave group" (Group settings) · 20. */
  leave: {
    stroke: 2,
    join: 'round',
    shapes: [
      path('M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4'),
      path('M9 8l-4 4 4 4'),
      path('M5 12h10'),
    ],
  },
  /** Share sheet (the system sheet as drawn): Messages · 26. */
  message: { stroke: 1.8, join: 'round', shapes: [path('M4 5h16v10H9l-5 4z')] },
  /** Share sheet: Mail · 26. */
  mail: { stroke: 1.8, join: 'round', shapes: [rect(3, 6, 18, 12, 2), path('M3 7l9 6 9-6')] },
  /** Share sheet: Notes · 26. */
  notes: {
    stroke: 1.8,
    join: 'round',
    shapes: [rect(5, 3, 14, 18, 2), path('M8 8h8M8 12h8M8 16h5')],
  },
  /** Share sheet: More (filled dots) · 26. */
  more: {
    stroke: 0,
    join: 'round',
    filled: true,
    shapes: [circle(5, 12, 1.8), circle(12, 12, 1.8), circle(19, 12, 1.8)],
  },
  /** Share sheet: Copy · 20. */
  copy: {
    stroke: 1.8,
    join: 'round',
    shapes: [
      rect(8, 8, 12, 12, 2),
      path('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'),
    ],
  },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof ICONS;

/** Every glyph name, in the order above (the kit gallery lists them). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Rendered size in points (the canvas uses 10, 12, 13, 14, 16, 18, 20, 22, 24, 26). */
  size: number;
  /** A resolved token colour (`tokens.iconMuted`, `tokens.accent`, …). */
  color: string;
  /** Stroke width in 24-unit viewBox units; defaults to the width the canvas draws this glyph with. */
  strokeWidth?: number;
}

/** A canvas glyph. Decorative: wrap it in a labelled control, never rely on it for meaning alone. */
export function Icon({ name, size, color, strokeWidth }: IconProps) {
  const glyph: Glyph = ICONS[name];
  const filled = glyph.filled === true;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G
        fill={filled ? color : 'none'}
        stroke={filled ? 'none' : color}
        strokeWidth={filled ? 0 : (strokeWidth ?? glyph.stroke)}
        strokeLinecap="round"
        strokeLinejoin={glyph.join}
      >
        {glyph.shapes.map((s, i) => {
          switch (s.k) {
            case 'path':
              return <Path key={i} d={s.d} />;
            case 'circle':
              return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
            case 'rect':
              return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />;
          }
        })}
      </G>
    </Svg>
  );
}
