import type { ReactNode } from "react";
import type { ElementType } from "../model/project";

/**
 * Pictograms for the Add panel: one 16×16 line icon per element type, in the editor's greyscale
 * (`currentColor`). Each one shows the *shape* of the element as it appears on the canvas — a
 * toggle is a pill with a knob, a table is a ruled grid — so the palette reads without the label.
 *
 * Drawing rules (keep when adding a type): 16×16 grid, 1.25 stroke, round caps/joins, at most one
 * filled accent area per icon, nothing closer than 1.5 units to the edge, no text glyphs.
 */

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

const SOLID = { fill: "currentColor", stroke: "none" };
const SOFT = { fill: "currentColor", fillOpacity: 0.22, stroke: "none" };

const ICONS: Record<ElementType, ReactNode> = {
  // A card with its label sitting on the border.
  container: (
    <>
      <path d="M4.2 3.5H3.5A1.5 1.5 0 0 0 2 5v6.5A1.5 1.5 0 0 0 3.5 13h9a1.5 1.5 0 0 0 1.5-1.5V5a1.5 1.5 0 0 0-1.5-1.5H9.4" {...S} />
      <path d="M5.8 3.5h2" {...S} strokeWidth={2} />
    </>
  ),
  // Top app bar: a strip with a menu mark, a title and an action dot.
  toolbar: (
    <>
      <rect x="1.5" y="5" width="13" height="6" rx="1.2" {...S} />
      <path d="M3.8 7h2M3.8 9h2" {...S} />
      <path d="M8 8h3" {...S} />
      <circle cx="12.6" cy="8" r=".9" {...SOLID} />
    </>
  ),
  // Side navigation: a filled left rail with entries.
  sidebar: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1.5" {...S} />
      <rect x="2" y="2" width="4.5" height="12" rx="1.5" {...SOFT} />
      <path d="M6.5 2v12" {...S} />
      <path d="M3.6 5h1.4M3.6 7.5h1.4M3.6 10h1.4" {...S} />
    </>
  ),
  // A phone with a tab bar at the bottom.
  bottomNav: (
    <>
      <rect x="3.5" y="1.5" width="9" height="13" rx="1.6" {...S} />
      <path d="M3.5 11h9" {...S} />
      <circle cx="6" cy="12.9" r=".7" {...SOLID} />
      <circle cx="8" cy="12.9" r=".7" {...SOLID} />
      <circle cx="10" cy="12.9" r=".7" {...SOLID} />
    </>
  ),
  // A modal window: title bar, close mark, an action button.
  dialog: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" {...S} />
      <path d="M2 6h12" {...S} />
      <path d="M11.2 4.1l1 1m0-1l-1 1" {...S} strokeWidth={1} />
      <rect x="9" y="9.3" width="3.8" height="2" rx=".7" {...SOLID} />
    </>
  ),
  // A rule with end ticks.
  divider: (
    <>
      <path d="M2 8h12" {...S} strokeWidth={1.6} />
      <path d="M2 5.8v4.4M14 5.8v4.4" {...S} strokeWidth={1} />
    </>
  ),
  // Paragraph: a heading line over text lines.
  text: (
    <>
      <path d="M2.5 4h6" {...S} strokeWidth={1.8} />
      <path d="M2.5 7.5h11M2.5 10h11M2.5 12.5h7" {...S} />
    </>
  ),
  // Picture placeholder: frame, sun, hills.
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" {...S} />
      <circle cx="5.6" cy="6.4" r="1.1" {...SOLID} />
      <path d="M2.4 12l3.6-3.6 2.4 2.4 2-2L13.6 12" {...S} />
    </>
  ),
  // A standalone symbol: a star.
  icon: (
    <path
      d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6L8 2z"
      {...S}
    />
  ),
  // Round user picture.
  avatar: (
    <>
      <circle cx="8" cy="8" r="6" {...S} />
      <circle cx="8" cy="6.4" r="2" {...S} />
      <path d="M4.1 12.2c.9-1.7 2.2-2.5 3.9-2.5s3 .8 3.9 2.5" {...S} />
    </>
  ),
  // Chip / tag: a pill with a leading dot.
  badge: (
    <>
      <rect x="1.5" y="5" width="13" height="6" rx="3" {...S} />
      <circle cx="5" cy="8" r=".9" {...SOLID} />
      <path d="M7.4 8h4" {...S} />
    </>
  ),
  // Rows with bullets.
  list: (
    <>
      <circle cx="3.4" cy="4.5" r=".9" {...SOLID} />
      <circle cx="3.4" cy="8" r=".9" {...SOLID} />
      <circle cx="3.4" cy="11.5" r=".9" {...SOLID} />
      <path d="M6.2 4.5h7.3M6.2 8h7.3M6.2 11.5h7.3" {...S} />
    </>
  ),
  // Ruled grid with a header band.
  table: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" {...S} />
      <rect x="2" y="3" width="12" height="3" rx="1.2" {...SOFT} />
      <path d="M2 6h12M2 9.5h12M6.5 3v10M10.5 3v10" {...S} strokeWidth={1} />
    </>
  ),
  // A tab strip: one tab lifted (open at the bottom), two others, and the content line below.
  tabs: (
    <>
      <path d="M1.5 7.5H5.4M10.6 7.5h3.9" {...S} />
      <path d="M5.4 7.5V4.6a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v2.9" {...S} />
      <path d="M1.8 7.5V5.8a.8.8 0 0 1 .8-.8h1.4M12.2 5h1.2a.8.8 0 0 1 .8.8v1.7" {...S} strokeOpacity={0.5} />
      <path d="M2.5 11h11M2.5 13.2h6.5" {...S} strokeOpacity={0.5} />
    </>
  ),
  // Bars over an axis.
  chart: (
    <>
      <path d="M2.5 2.5v11h11.5" {...S} />
      <rect x="5" y="8" width="2" height="5" rx=".4" {...SOLID} />
      <rect x="8.4" y="5" width="2" height="8" rx=".4" {...SOLID} />
      <rect x="11.8" y="7" width="2" height="6" rx=".4" {...SOLID} />
    </>
  ),
  // Push button with a caption bar.
  button: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="2" {...S} />
      <path d="M5.5 8h5" {...S} strokeWidth={1.5} />
    </>
  ),
  // Square icon-only button.
  iconButton: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="3" {...S} />
      <path d="M8 5.2v5.6M5.2 8h5.6" {...S} />
    </>
  ),
  // Single-line field with a caret.
  input: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="1.5" {...S} />
      <path d="M4.2 6.6v2.8" {...S} strokeWidth={1.5} />
    </>
  ),
  // Multi-line field with a resize corner.
  textarea: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" {...S} />
      <path d="M4.5 5.5h5.5M4.5 8h4" {...S} />
      <path d="M12.6 10.6l-2 2m2-.2l-.8.8" {...S} strokeWidth={1} />
    </>
  ),
  // Select: a field with a chevron.
  dropdown: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="1.5" {...S} />
      <path d="M4 8h4" {...S} />
      <path d="M10.4 7.2L12 9l1.6-1.8" {...S} />
    </>
  ),
  // A checked box.
  checkbox: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.2" {...S} />
      <path d="M5.2 8.2l2 2 3.6-4" {...S} strokeWidth={1.5} />
    </>
  ),
  // A selected radio.
  radio: (
    <>
      <circle cx="8" cy="8" r="5.6" {...S} />
      <circle cx="8" cy="8" r="2.4" {...SOLID} />
    </>
  ),
  // A pill switch with its knob on the right.
  toggle: (
    <>
      <rect x="1.5" y="4.5" width="13" height="7" rx="3.5" {...S} />
      <circle cx="11" cy="8" r="2.1" {...SOLID} />
    </>
  ),
  // Track, filled part and a knob.
  slider: (
    <>
      <path d="M2 8h12" {...S} strokeOpacity={0.45} />
      <path d="M2 8h6" {...S} strokeWidth={2} />
      <circle cx="8.5" cy="8" r="2.2" fill="var(--surface, #fff)" stroke="currentColor" strokeWidth={1.25} />
    </>
  ),
  // A bar that is partly filled.
  progress: (
    <>
      <rect x="1.5" y="6" width="13" height="4" rx="2" {...S} />
      <rect x="1.5" y="6" width="8" height="4" rx="2" {...SOLID} />
    </>
  ),
  // Canvas: two shapes joined by an arrow.
  diagram: (
    <>
      <rect x="1.5" y="2" width="5.5" height="4.2" rx=".9" {...S} />
      <rect x="9" y="9.8" width="5.5" height="4.2" rx=".9" {...S} />
      <path d="M4.2 6.2v3.6h4.2" {...S} />
      <path d="M7 8.4l1.6 1.4L7 11.2" {...S} />
    </>
  ),
  // Drawing: a pencil.
  drawing: (
    <>
      <path d="M2.6 13.4l.9-3.1 7.4-7.4a1.5 1.5 0 0 1 2.1 2.1l-7.4 7.4-3 1z" {...S} />
      <path d="M9.6 4.3l2.1 2.1" {...S} />
    </>
  )
};

export function ElementIcon({ type, size = 16 }: { type: ElementType; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      {ICONS[type]}
    </svg>
  );
}
