---
name: pbooth
description: Photobooth event management: admin, booth kiosk and guest galleries
colors:
  lime-key: "#c6f36b"
  lime-key-edge: "#9fcc45"
  key-ink: "#0b0f05"
  periwinkle-sched: "#a9b8ff"
  periwinkle-sched-edge: "#8193e6"
  ash-cap: "#e1e0da"
  ash-cap-ink: "#3a3a3a"
  warn-light: "#b8310f"
  warn-dark: "#ff6a45"
  paper: "#f3efe6"
  ink: "#0b0c0a"
  muted-light: "#4c4f48"
  night: "#050607"
  night-ink: "#f1f2ee"
  muted-dark: "#a8aca2"
typography:
  display:
    fontFamily: "Cormorant Garamond Variable, Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(40px, 7vw, 92px)"
    fontWeight: 300
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Cormorant Garamond Variable, Cormorant Garamond, Georgia, serif"
    fontSize: "clamp(22px, 2.2vw, 28px)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Roboto Mono Variable, Roboto Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto Mono Variable, Roboto Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  input: "0px"
  inner: "8px"
  key: "12px"
  side-card: "20px"
  sheet: "22px"
  pill: "999px"
spacing:
  gutter: "16px"
  key-gap: "14px"
  sheet-pad: "clamp(20px, 2.6vw, 30px)"
components:
  button-primary:
    backgroundColor: "{colors.lime-key}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.pill}"
    padding: "9px 20px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.lime-key-edge}"
    textColor: "{colors.key-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "9px 20px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.warn-light}"
    rounded: "{rounded.pill}"
    padding: "9px 20px"
  key-live:
    backgroundColor: "{colors.lime-key}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.key}"
  key-scheduled:
    backgroundColor: "{colors.periwinkle-sched}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.key}"
  key-idle:
    backgroundColor: "{colors.ash-cap}"
    textColor: "{colors.ash-cap-ink}"
    rounded: "{rounded.key}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "8px 0"
---

# Design System: pbooth

## Overview

**Creative North Star: "Quiet Glass, Lime Keys"**

pbooth is run by one owner and a few staff, often at a venue on a phone or a laptop beside a booth. The admin is a working tool: quiet editorial type, a slow lime-and-periwinkle shader gradient behind everything, and content on light glass sheets. Colour is spent almost entirely on state: lime means live or primary, periwinkle means scheduled, ash means idle or done. Everything else is ink on paper (or paper on night).

The one flourish is tactile: events, booths and stations are keycaps on a slab that press down and lift under the pointer (WebGL, on demand). Sign-in and sign-out get a short liquid-metal logo moment; nowhere else animates for show. The kiosk shares the type but runs dark, full-screen, in the event's own colours; the guest gallery takes the event's colours too, with button colours chosen by measured contrast.

**Key Characteristics:**
- One large serif statement per page, ending in a full stop ("Stations."), over small mono labels.
- One glass sheet per section; nothing nested in a second box.
- Lime is rare: the primary button, live keys, the live dot.
- Status is a coloured dot and a word, never a filled badge.
- Light and dark both designed; dark mode is chosen by the viewer, not by category.

## Colors

A warm paper and near-black pair, one acid-lime accent, one periwinkle second state, and a burnt red reserved for errors and destructive actions.

### Primary
- **Acid Lime** (lime-key, edge lime-key-edge): the primary button, live event and online booth keycaps, the live dot. Text on it is always key-ink.

### Secondary
- **Periwinkle** (periwinkle-sched, edge periwinkle-sched-edge): scheduled events and enrolled-but-idle booths; the cool half of the background gradient.

### Neutral
- **Warm Paper** (paper) and **Ink** (ink): light-mode page and text; **Night** (night) and **Night Ink** (night-ink) in dark mode.
- **Muted** (muted-light / muted-dark): secondary lines, hints, labels; 7.3:1 and 8.8:1 on their pages.
- **Ash** (ash-cap, ash-cap-ink): idle, draft and wrapped keycaps.
- **Burnt Red** (warn-light, 5.2:1 on paper; warn-dark on night): errors, danger buttons, failed states. Never used for decoration.

### Named Rules
**The Lime Is Rare Rule.** Lime marks what's live or the one main action in an area. If two lime buttons sit side by side, one of them is secondary.

**The Dot And Word Rule.** State reads as a 7px dot plus a plain word. Colour alone never carries meaning.

## Typography

**Display Font:** Cormorant Garamond Variable (with Georgia)
**Body Font:** Roboto Mono Variable (with ui-monospace)

**Character:** a light, editorial serif for titles against a quiet mono for everything you read and operate; self-hosted (OFL).

### Hierarchy
- **Display** (300, clamp(40px, 7vw, 92px), 1.02): page titles, a short noun with a full stop. Inner pages use the compact size (up to 76px).
- **Headline** (400, clamp(22px, 2.2vw, 28px), 1.15): one per glass sheet, with its explanation as a plain line under it.
- **Body** (400, 13px, 1.5): all copy, table cells, buttons.
- **Label** (500, 11px, 0.05em, uppercase): field labels, table headers, sidebar card titles, keycap captions. The only uppercase text besides small row buttons.

### Named Rules
**The Serif For Titles Only Rule.** The serif never sets a sentence of UI copy or a button.

## Layout

Pages sit in a 1240px column with a 16px gutter. List pages: compact hero, then glass sheets stacked. Detail pages: a header row (back link, title with status, meta, actions), then a main column and a 340px sidebar that stacks below 960px. Tabs sit in their own row above both columns and scroll sideways on phones instead of wrapping. Keycap grids fill with auto-fill columns (150px minimum, 14px gaps). The theme toggle sits at the bottom-left of the page and the primary "+ New" action at the bottom-right, anchored to the page end, not floating over content.

## Elevation & Depth

Depth comes from light, not stacking. Glass sheets carry a bright 1px top rim, a faint bottom return and a soft drop shadow; only small floating pieces (the hover ticket, dialogs, the summary chip) are frosted with blur, so scrolling stays cheap. Keycaps are the one physical object: a 4px bottom edge that compresses to 2px when pressed.

### Shadow Vocabulary
- **Sheet** (`inset 0 1px 0 var(--rim), inset 0 -1px 0 var(--rim-soft), 0 18px 40px -22px rgba(0,0,0,.45)`): every glass section.
- **Floating** (`inset 0 1px 0 var(--rim), 0 24px 60px -20px rgba(0,0,0,.5)` with `backdrop-filter: blur(22px) saturate(1.5)`): hover ticket and dialogs.
- **Keycap** (`inset 0 -4px 0 <edge>`, pressed `inset 0 -2px 0 <edge>, 0 0 0 2px var(--ring)`): tiles.

### Named Rules
**The One Box Rule.** A section is one glass sheet; panels inside it have no second frame.

## Shapes

Generous, soft corners on containers (22px sheets, 20px sidebar cards, 12px keycaps), full pills for every button, chip and tab, and square, borderless inputs that are just an underline. Photos keep their own shape: tiles take the set's usual aspect and show each image whole.

## Components

### Buttons
- **Shape:** full pill (999px).
- **Primary:** lime with key-ink text, 9px 20px; hover deepens to the lime edge colour.
- **Secondary:** transparent with a 28% ink outline; hover tints 8% ink. **Danger:** the same in burnt red.
- **Row buttons:** the secondary style at 5px 14px, uppercase, for actions inside lists.
- **Focus:** a 2px ring in the ring colour, 3px off the edge, on every focusable element.

### Icon actions
Square-ish 32px buttons in a row, one colour per meaning on a 13% tint: download green, print amber, link blue, delete red, each with lighter shades in dark mode and an accessible name.

### Cards / Containers
- **Corner Style:** 22px sheets, 20px sidebar cards.
- **Background:** the glass tint over the gradient.
- **Shadow Strategy:** see Sheet above.
- **Internal Padding:** clamp(20px, 2.6vw, 30px).

### Inputs / Fields
- **Style:** no box; a 1px underline, 15px mono text, the label above in the label style and a hint or error line below.
- **Focus:** the underline doubles to 2px in ink without moving the text.
- **Error:** the line below turns burnt red and names the problem.

### Navigation
A floating glass strip: logo mark left, mono tab links centred (current page underlined in ink), sign-out icon right. On phones the links tighten; nothing hides behind a menu.

### Keycaps (signature)
Events, booths and stations as tiles: a tiny label on top, a mono code, the name below. Lime for live, periwinkle for scheduled, ash for idle, red for a booth error. They press down 2px on hover or focus and lift in 3D through the WebGL layer when the pointer is near.

## Do's and Don'ts

### Do:
- **Do** set every dynamic value (colours, aspect ratios, crops) through a CSS variable from a ref; the page's security policy refuses inline `style`.
- **Do** keep burnt red at 4.5:1 or better wherever it's text.
- **Do** keep reduced motion meaningful: no travel or scaling, but fades, colour changes and progress fills stay.
- **Do** use native `<dialog>` with `showModal()` for anything that interrupts.

### Don't:
- **Don't** add a second accent colour, or use lime for decoration.
- **Don't** nest a card inside a glass sheet.
- **Don't** add uppercase beyond labels and row buttons.
- **Don't** crop guests' photos in a gallery; show each one whole.
- **Don't** animate on a failure (a wrong password gets no flourish).
