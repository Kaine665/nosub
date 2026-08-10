# Shared UI Components

Chrome extension overlay UI — vanilla TypeScript string templates + Shadow DOM. No React/Vue component library.

## WordPopup (`src/ui/components/word-popup.ts`)
Floating dictionary card over YouTube. Width 380px. Dark glassmorphism panel.

Key visual pieces:
- Header: word (26px/700 white) + UK/US IPA + circular audio buttons + close ×
- Body: section labels「释义」「例句」; POS pills `.nc-pos`; sense rows; example quotes with left blue border
- Colors: bg `rgba(18,18,24,0.96)`, border `rgba(255,255,255,0.1)`, radius 18px, blur 28px, shadow `0 16px 56px rgba(0,0,0,0.6)`
- Audio active: `#8fd0ff` / `rgba(110,198,255,0.14)`

## ControlBar (`src/ui/components/control-bar.ts`)
Apple-style bottom bar: NOSUB brand + A/S/D/E key controls. Height 44px, radius 14px, frosted glass.

## SubtitleDisplay (`src/ui/components/subtitle-display.ts`)
Word-level cue line over video; clickable words open WordPopup.
