import './style.css';

const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';
const VISITOR_KEY = 'nosub-anonymous-visitor-v1';

function anonymousVisitorId(): string {
  const existing = localStorage.getItem(VISITOR_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(VISITOR_KEY, created);
  return created;
}

function trackPageView(): void {
  const query = new URLSearchParams(window.location.search);
  let referrerHost = '';
  try { referrerHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* ignore */ }
  void fetch(`${API_URL}/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      event_name: 'page_view', anonymous_id: anonymousVisitorId(), path: window.location.pathname,
      referrer_host: referrerHost || null,
      utm_source: query.get('utm_source'), utm_medium: query.get('utm_medium'),
      utm_campaign: query.get('utm_campaign'),
    }),
  }).catch(() => undefined);
}

trackPageView();

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <main>
    <nav class="nav shell" aria-label="Primary navigation">
      <a class="brand" href="./" aria-label="NoSub home">
        <span class="brand-mark" aria-hidden="true">N</span><span>NoSub</span>
      </a>
      <div class="nav-actions">
        <a class="nav-link" href="#how-it-works">How it works</a>
        <a class="nav-button" href="https://chromewebstore.google.com/detail/gjdbacmibabccgnjckmgflaomjboibji">Add to Chrome</a>
      </div>
    </nav>

    <section class="hero shell">
      <div class="eyebrow"><span></span> Built for focused listeners</div>
      <h1>Turn real YouTube videos into<br><em>English listening practice.</em></h1>
      <p>Repeat the moment. Reveal the line. Understand every word.<br>NoSub turns videos you already love into deliberate practice.</p>
      <div class="hero-actions">
        <a class="hero-cta" href="https://chromewebstore.google.com/detail/gjdbacmibabccgnjckmgflaomjboibji">Add to Chrome <span aria-hidden="true">→</span></a>
        <a class="text-cta" href="#how-it-works">See how it works</a>
      </div>
    </section>

    <section class="feature-section shell" id="how-it-works" aria-labelledby="features-title">
      <div class="section-heading">
        <div><p class="kicker">Listen with intention</p><h2 id="features-title">A simple loop for<br>serious progress.</h2></div>
        <p class="pricing-intro">Stay inside YouTube while NoSub gives you the controls needed for deliberate listening practice.</p>
      </div>
      <div class="feature-grid">
        <article><span>01</span><h3>Repeat the moment</h3><p>Loop the current line until real speech becomes clear.</p><kbd>A</kbd></article>
        <article><span>02</span><h3>Reveal on demand</h3><p>Listen first, then reveal the original line and translation only when needed.</p><kbd>S</kbd></article>
        <article><span>03</span><h3>Understand each word</h3><p>Click a word for its meaning, pronunciation, and useful examples.</p><kbd>↗</kbd></article>
      </div>
    </section>

    <section class="pro-callout shell">
      <div><p class="kicker">Ready when you are</p><h2>Start with a video you love.</h2><p>Install NoSub, open YouTube, and use the extension settings to shape your listening practice.</p></div>
      <a class="hero-cta" href="https://chromewebstore.google.com/detail/gjdbacmibabccgnjckmgflaomjboibji">Add to Chrome <span aria-hidden="true">→</span></a>
    </section>

    <footer class="shell">
      <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">N</span><span>NoSub</span></a>
      <p>© 2026 Wuxi Gongqian Technology Co., Ltd.</p>
      <div class="footer-links">
        <a href="./terms.html">Terms</a><a href="./privacy.html">Privacy</a>
        <a href="./refund.html">Refunds</a><a href="mailto:xl1469608@gmail.com">Support</a>
      </div>
    </footer>
  </main>
`;
