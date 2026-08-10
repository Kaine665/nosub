# Layouts

No app shell / router. UI is injected into YouTube pages.

## Listening overlay (`src/ui/listening-ui.ts`)
Shadow DOM root `.nosub-overlay`:
1. Subtitle cue box (center above video controls)
2. WordPopup (fixed, above cue)
3. ControlBar (below cue)

Floating panels only — no sidebar/nav/footer.
