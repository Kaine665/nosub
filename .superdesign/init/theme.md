# Theme — nosub

## Compact tokens

**Brand:** NOSUB — focused YouTube listening practice.

**Surfaces**
- Overlay glass: `rgba(18,18,24,0.96)` / `rgba(28,28,30,0.72)`
- Border: `rgba(255,255,255,0.08–0.12)`
- Blur: 20–28px
- Radius: bar 14px, card 18px, pills 4–6px

**Text**
- Primary: `#fff` / `#e8e8e8` / `#F2F0E6` (cue)
- Secondary: `rgba(255,255,255,0.45–0.62)`
- Muted labels: `rgba(255,255,255,0.28)`
- Font: system-ui / Segoe UI / YouTube Sans / Roboto

**Accent**
- Audio / example edge: `#8fd0ff`, `rgba(110,198,255,0.14–0.25)`
- Active word highlight: `rgba(255,220,60,0.35)`
- Error audio: `#ff8a80`

**Motion**
- Card enter: `nc-in` 0.2s ease-out (fade + translateY 10px)
- Cue fade: 0.18s

## Raw CSS (excerpt from `src/ui/styles/nosub.css`)

Cue line: 28px/500, cream `#F2F0E6`, dark frosted pill background.
Control bar: frosted dark, uppercase brand, key+label chips.
