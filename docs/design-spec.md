# Bordeaux v2 design spec: "Hallmark"

Dark is **Quiet Wine** and light is **Ivory Merlot**, both with quiet neutral hairlines and gold used sparingly. The target is GNOME 46 on Ubuntu 24.04 (Wayland, Ubuntu Dock on the left).

Reference scenes are in `v2-previews/`:
- `signature-{dark,light}.html` is the signature direction.
- `final-{dark,light}.html` is the tidy baseline, kept for comparison.

**Colour roles:** burgundy marks *state*: on, chosen value, primary action. Gold marks *place*: where you are or what has focus, and nothing else. It is never an edge, rule, strip, tick or arc; slab edges are a uniform 1px neutral hairline.

## Tokens
| Token | Dark | Light | Use |
|---|---|---|---|
| bg-0 / bg-1 | `#0E0B0C` / `#151112` | `#E8DFD3` / `#F8F4EE` | desktop / window |
| sidebar · card | `#120E0F` · `#1C1718` | `#EFE8DD` · `#FDFBF7` | split-view sidebar · boxed lists, entries |
| matte · tile | `#181314` · `#231D1E` | `#F3EEE6` · `#ECE4D8` | bento cards inside slabs · buttons, off tiles, location fill |
| bg-3 / bg-4 | `#262021` / `#2F2829` | `#E6DDCF` / `#DCD1C1` | raised / pressed |
| border / border-soft | `#332A2C` / fg-0 at 6% | `#D6CAB9` / fg-0 at 6% | edges, separators / seams |
| fg-0 / fg-1 / fg-2 | `#EEE7E4` `#C3B8B5` `#9E9390` | `#2B1A1E` `#5A454A` `#6B575B` | text tiers |
| accent / press / on-accent | `#8E2A44` `#7A2239` `#FFF3F1` | `#7A1C34` `#64162A` `#FFF7F2` | state fills |
| accent-text · sel | `#E09AAE` · `#32171E` | `#7A1C34` · `#EAD9D6` | chosen label, links · selected list row |
| gold · gold-line · gold-text | `#C9AE86` · 30% · `#D4BC95` | `#B08D57` · 55% · `#6F5218` | dots · focus · selected Alt-Tab outline · links |
| focus · ring-glow | `#C9AE86` · gold at 14% | `#8C6B33` · gold at 16% | focus hairline · bloom |
| glass (slab) | `rgba(22,17,18,.86)`, island `.74` | `rgba(250,247,242,.88)`, `.72` | shell material, blur 22–28 |
| sheen | fg-0 at 3.5% | white at 55% | slab top gradient |
| danger · success · warning · info | `#EC7D86` `#8CC2A1` `#E2B06A` `#9FB6DA` | `#A3232E` `#2E6B44` `#7A4A0A` `#2F558C` | status |
| term bg / fg | `#110D0E` / `#DDD3D0` | `#FBF8F3` / `#2B1A1E` | terminal; ANSI as `--a0..a7` |

**Contrast:** checked with a WCAG 2.1 script. The baseline set has 73 pairs per variant and the signature surfaces another 45 (matte, tile, glass composited over the wallpaper and its glow, island, card, sidebar). Everything passes 4.5:1; the lowest pair is 5.36 in dark and 4.90 in light. The focus colour meets the 3:1 non-text minimum (8.8 dark, 4.5 light).

## The Hallmark signature
1. **Slab material** for every floating shell surface: dock, QS, banner, app grid, Alt-Tab, OSD, modal, tooltip. It is glass with a top sheen, a uniform 1px `border` hairline on all four sides (asymmetric per-side borders taper to nothing at rounded corners, so they are not used), and e4 depth. App windows stay **matte and opaque**. The contrast between glass shell and matte apps is the point.
2. **Cut corner:** slabs use `border-radius: 6 22 22 22`, with the top-left corner nearly square, like a wine-label cut. App windows keep a uniform 14.
3. **Place marks (gold dots, no strips):** gold appears as small round dots or full outlines only.
   - the focused dock app gets a 4px round gold dot (running apps get a fg-2 dot; the dock uses ubuntu-dock's DEFAULT indicator style, not DASHES);
   - the current Alt-Tab item gets a thin gold full outline;
   - the workspace switcher popup shows round dots, the active one gold;
   - the top-bar workspace indicator stays neutral light, because the shell stretches the active dot into a pill that no CSS can prevent, and a stretched gold dot reads as a strip;
   - the GTK sidebar location is a tile fill only, with no gold bar.
4. **Islands top bar:** the bar itself is transparent. It holds three capsules: workspace dots, a Geist Mono clock (`THU 23 OCT │ 14:07` with tabular numerals and a gold divider), and the tray. Each capsule has the same uniform 1px hairline as the slabs.
5. **Type character:**
   - Eyebrow labels are Geist Mono 10.5px, weight 500, tracking .14em, small caps. They're used for section headers, notification source and time, chips, QS captions and the lock-screen date.
   - Numerals are always Geist Mono with `tnum`.
   - Scale contrast is strong: page title 30/600 at −.025em, QS battery 30 mono, lock clock 86–120 Geist 200 at −.045em.
6. **Monogram:** a mono "B" (or the user's initial) in a 1px `border` ring. It appears once each in the QS footer and on the lock screen, nowhere else.
7. **Focus:** a 1px `focus` hairline at a 3px offset plus a 6px `ring-glow` bloom, shown on `:focus-visible` only. This replaces the usual thick ring.
8. **Bento QS** inside the native 2-column grid:
   - a system card (big mono battery figure plus round actions);
   - one matte card holding both sliders, each with a mono value;
   - 58px tiles with an icon chip;
   - a footer with the monogram.
9. **Notification and modal language:** an eyebrow header (source, time), a 15/600 title, the body in fg-1, then a full-width split action footer with hairline dividers. The primary action is in accent-text.
10. **Wallpaper:** a procedural SVG of fine concentric contour arcs (gold at 7% dark, merlot at 7% light) spreading from the lower right over the wine glow, plus 5% grain. No imagery.

**Gold never appears** as a fill, a strip, an edge or a tick, on body text, on icons, on hover or error states, or twice on the same control. It is used for (a) the keyboard focus ring, (b) small round dots for the focused dock app and the workspace-switcher active state, and (c) the thin full outline of the selected Alt-Tab item. On app windows it appears only as the focus ring.

## What it takes to build each part
| Element | How it's built |
|---|---|
| Slab, cut corner, edge, sheen | User-theme CSS: per-corner `border-radius`, a uniform `border`, 2-stop `background-gradient`. St draws **one `box-shadow` per node**, so the drop shadow sits on the outer node and the edge is the border. The slabs are 0.86-opaque glass; blur-my-shell popup blur is off (see risks). |
| Islands top bar, mono clock | CSS: transparent `#panel`, styled `.panel-button` capsules and `.clock` font. Just Perfection handles panel size and spacing. |
| Workspace dots | CSS: `.workspace-dot` set to 6px round, neutral. The JS already does the 3.25× active stretch and 50% fade. |
| Dock dots (running, focused) | CSS on `.app-well-app-running-dot` and `.focused`, using ubuntu-dock's DEFAULT indicator style. |
| Eyebrows | CSS gives `font-family`, `letter-spacing` and `font-variant: small-caps`. **St has no `text-transform`**, so true all-caps needs an **extension**; GTK4 labels get it from `font-variant-caps: all-small-caps`. |
| Focus hairline (GTK) | GTK4 CSS: `outline` + `outline-offset` and `box-shadow`. The sidebar location is a tile fill. |
| Notification, modal, Alt-Tab styling | CSS: GNOME 46 banners already have a source header. Alt-Tab already shows only the selected label; style `.item-box:selected` with a thin gold full outline. |
| Bento QS (styling, native spans) | CSS. **Varied spans or stacked tiles need an extension** (`column-span` is set in JS). |
| OSD mono numeral, monogram in QS footer | **Extension-required, optional.** |
| Per-icon aura | **Extension-required:** the small Bordeaux companion extension (below). |
| Motion curves, edge reveal on open | **Extension-required, optional.** St CSS only has `transition-duration`. |
| Wallpaper | A generated SVG/PNG asset set via gsettings. |

## Shape, space, depth, motion
- **Radii:** 4 chips · 8 buttons and entries · 12 cards and lists · 14 windows · 16 tiles and cells · 6/22 slabs · 15 islands.
- **Spacing:** 4-pt scale `4 8 12 16 24 32 48`. List rows are at least 56px, sidebar rows 38px, the header bar 46px, islands 30px with an 8px top margin.
- **Elevation:**
  - e1 cards: `0 1 2`.
  - e2 tooltips: `+0 6 16`.
  - e3 windows: `0 2 4, 0 12 28, 0 32 64`.
  - e4 focused window and slabs: `0 2 6, 0 18 40, 0 48 96`.
  - Shadow colour is black at 30–42% in dark and `rgb(60,30,35)` at 8–16% in light.
- **Motion:**
  - standard `cubic-bezier(.2,0,0,1)` 200ms;
  - enter `cubic-bezier(.05,.7,.1,1)` 300ms, scale .96→1;
  - exit `cubic-bezier(.3,0,.8,.15)` 150ms;
  - no bounce; reduced motion sets durations to 0.

## Dock aura
- **Source:** the original icon, never recoloured. Find the dominant colour with Unity weighting (`0.1·255² + 0.9·α·sat`) on a pixbuf of 64px or smaller, then convert to OKLCH.
- **Clamps:** L is 0.62–0.74 in dark and 0.66–0.76 in light. C is capped at 0.12 / 0.11. Then mix 15% toward the accent-text hue in OKLab.
- **Intensity:** α = lerp(min, max, smoothstep(C 0.02→0.10)), 0.10→0.34 in dark and 0.14→0.46 in light. Neutral icons sit at the minimum. α is capped at 0.55, and the user's intensity setting (default 38%) multiplies it.
- **Geometry:** a disc 0.55× the icon size, plus a halo `box-shadow: 0 0 22px 12px`, offset +2px y.
- **States:** focused app ×1.3 (plus the gold dot). Hover ×1.6, with the icon scaled to 1.06. Pressed ×0.8. Launching pulses ×1→1.6 twice over 600ms.
- **Where it shows:** always in the dock. In Alt-Tab at ×1, or ×1.6 for the current item. In the app grid only on hover or focus, at ×1.4.

## Aura feasibility
Pure CSS can't do it, because dash items carry no per-app class.

**Recommended:** a small companion extension.
- `ubuntu-dock` exports `dockManager` (`allDocks → dash._box`) and ships a `DominantColorExtractor` with an app-id cache (`appIconIndicators.js:1037`). Copy that algorithm rather than importing it.
- Insert our own `St.Widget` disc **below** the icon in `_iconContainer`. Never call `set_style` on the existing children, because backlit mode owns them.
- Watch `child-added`, `notify::focus-app` and icon-theme changes. Cache by `app-id + theme` in `~/.cache/bordeaux-aura.json`.

An offline scanner goes stale on new installs and theme switches, and it still needs the extension to apply the colours. Keep it only as a warm cache.

**Risks:**
- Dock internals are private: pin `shell-version 46` and guard every lookup.
- Dash rebuilds mean re-attaching on every rebuild.
- Shadow repaint cost on hover is unprofiled.
- Symbolic-only icons fall back to neutral.
- Test with `dbus-run-session gnome-shell --nested`.

## Open risks for the signature
- blur-my-shell popup blur is off (its rectangular surface is a second source of a box around popups). The box seen on the real desktop was the popup content's own drop shadow, clipped by the BoxPointer to a hard-edged rectangle, so popup content nodes carry `box-shadow: none`.
- The overview wallpaper is blur-my-shell's overview component with a radius-0 pipeline (dim only). If Super feels laggy again, set `blur-my-shell.overview blur false`; the backdrop then falls back to flat `bg-0`.
- St per-side border colours on rounded corners taper to nothing at the corners, which is why borders are uniform.
- Just Perfection or a Shell update may reset panel spacing.
- Synthetic small caps in Geist (it has no `smcp` feature) can look light. If so, drop to plain mono at .12em tracking.
- Islands leave a transparent strut, so maximised windows still start below 46px.
