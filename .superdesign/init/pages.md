# Pages / surfaces

## YouTube Listening Overlay
Entry: `src/ui/listening-ui.ts`
Dependencies:
- `src/ui/components/subtitle-display.ts`
- `src/ui/components/control-bar.ts`
- `src/ui/components/word-popup.ts`  ← design target
- `src/ui/styles/nosub.css`
- `src/assistance/dictionary-service.ts` (data only)
- `src/shared/i18n.ts`

## WordPopup (isolated)
Entry: `src/ui/components/word-popup.ts`
Dependencies:
- inline styles in `buildShell` / `render` / `fillPhonetic`
- no shared CSS classes except `.nc-*` injected in shell
