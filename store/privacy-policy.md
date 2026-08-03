# Privacy Policy for nosub

**Last updated:** 2026-08-03

## Data Collection

nosub does **not** collect, store, or transmit any personally identifiable information.

### What nosub accesses locally:

- **YouTube video subtitles**: Read from the YouTube page to display in the nosub overlay. This data stays in your browser and is never sent anywhere.
- **User preferences**: Stored locally using Chrome's `storage.local` API. Includes subtitle display settings (show/hide, reveal level). This data never leaves your device.

### What nosub sends to external services:

- **Dictionary lookups**: When you click a word, nosub queries `api.dictionaryapi.dev` (Free Dictionary API) to retrieve definitions. Only the word you clicked is sent. No user identity, browsing history, or other context is transmitted.
- **Google Translate** (optional): If translation is configured, subtitle text may be sent to Google's translation service. Only the text to translate is sent.
- **Tatoeba**: When you look up a word, nosub may send that word to Tatoeba to retrieve example sentences. No user identity, browsing history, or video context is sent.

### What nosub does NOT do:

- Does not track your browsing history
- Does not collect analytics or usage statistics
- Does not use cookies or fingerprinting
- Does not share data with third parties
- Does not have user accounts or authentication

## Data Retention

All data (preferences) is stored locally on your device and is automatically removed when you uninstall the extension.

## Permissions

- `storage`: Required to save your preferences locally
- `activeTab`: Used only after you click the NoSub toolbar icon, so the popup can identify and reload the current YouTube tab when you enable or pause NoSub
- `https://www.youtube.com/*`: Required to function on YouTube video pages
- `https://api.dictionaryapi.dev/*`: Required for dictionary lookups
- `https://translate.googleapis.com/*`: Required for translation features
- `https://tatoeba.org/*`: Required to retrieve example sentences for word lookups

## Changes

If this policy changes, the updated version will be included with the extension update.

## Contact

For questions about this privacy policy, open an issue at the extension's GitHub repository.
