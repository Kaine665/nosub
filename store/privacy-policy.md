# Privacy Policy for nosub

**Last updated:** 2026-08-10

## Data Collection

NoSub does not sell user data or use it for advertising. Most features work without an account. If you choose to create an account or subscribe to NoSub Pro, the account and subscription data described below is processed to provide those services.

### What nosub accesses locally:

- **YouTube video subtitles**: Read from the YouTube page to display in the nosub overlay. This data stays in your browser and is never sent anywhere.
- **User preferences**: Stored locally using Chrome's `storage.local` API. Includes subtitle display settings (show/hide, reveal level). This data never leaves your device.
- **Account session**: If you sign in, Supabase authentication tokens and a short-lived account/subscription cache are stored in Chrome local storage so NoSub can keep you signed in and show your plan status.

### What nosub sends to external services:

- **Dictionary lookups**: When you click a word, NoSub may query Free Dictionary API, Youdao, ICIBA, or the NoSub dictionary server to retrieve definitions and pronunciation data. Only the selected word and the minimum technical request data needed to answer the request are sent. The dictionary source can be changed in settings.
- **Google Translate** (optional): If translation is configured, subtitle text may be sent to Google's translation service. Only the text to translate is sent.
- **Tatoeba**: When you look up a word, nosub may send that word to Tatoeba to retrieve example sentences. No user identity, browsing history, or video context is sent.
- **Account service (optional)**: If you create an account or sign in, your email address, password, authentication tokens, and account identifier are sent to and processed by Supabase for authentication. NoSub retrieves your subscription identifier, plan, status, and renewal/end date from Supabase to enable paid features.
- **Billing (optional)**: Purchases and subscription management take place through Paddle. Paddle processes payment details on its own hosted pages; the extension does not receive or store full payment-card details. Subscription status is synchronized to NoSub's account service.

### What nosub does NOT do:

- Does not track your browsing history
- Does not collect analytics or usage statistics
- Does not use cookies or fingerprinting
- Does not sell user data or share it for advertising
- Does not transmit browsing history or video URLs to account or billing services

## Data Retention

Local preferences, authentication tokens, and cached account information are removed when you uninstall the extension. Account and subscription records are retained by Supabase and Paddle as needed to provide the account, billing, security, and legally required recordkeeping. You may sign out to remove the local session and contact us to request account deletion.

## Permissions

- `storage`: Required to save your preferences locally
- `activeTab`: Used only after you click the NoSub toolbar icon, so the popup can identify and reload the current YouTube tab when you enable or pause NoSub
- `https://www.youtube.com/*`: Required to function on YouTube video pages
- `https://api.dictionaryapi.dev/*`: Required for dictionary lookups
- `https://dict.youdao.com/*`: Required for optional dictionary definitions and pronunciation audio
- `https://dict-mobile.iciba.com/*`: Required for optional dictionary definitions
- `https://ssl.gstatic.com/*`: Required to play pronunciation audio returned by dictionary services
- `https://translate.googleapis.com/*`: Required for translation features
- `https://tatoeba.org/*`: Required to retrieve example sentences for word lookups
- `http://43.130.246.125/*`: Required for the NoSub dictionary fallback service
- `https://eyqnncnryfcnwtgupoxy.supabase.co/*`: Required for optional account authentication and subscription-status features

## Changes

If this policy changes, the updated version will be published at this URL.

## Contact

For questions about this privacy policy, open an issue at the extension's GitHub repository.
