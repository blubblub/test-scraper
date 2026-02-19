# Anti-Detection Web Scraping with Crawlee + Playwright

> Comprehensive guide for building scrapers that evade bot detection systems (Cloudflare, Akamai, PerimeterX, etc.) using Apify's Crawlee framework with Playwright.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Browser Fingerprint Evasion](#browser-fingerprint-evasion)
3. [Stealth Plugins & Configuration](#stealth-plugins--configuration)
4. [Proxy Rotation Strategies](#proxy-rotation-strategies)
5. [Request Patterns & Human-Like Behavior](#request-patterns--human-like-behavior)
6. [Header Management](#header-management)
7. [Cloudflare / Akamai / PerimeterX Bypass](#cloudflare--akamai--perimeterx-bypass)
8. [Cookie & Session Management](#cookie--session-management)
9. [Crawlee-Specific Anti-Detection Features](#crawlee-specific-anti-detection-features)
10. [Common Detection Vectors](#common-detection-vectors)
11. [Complete Example](#complete-example)
12. [Quick Checklist](#quick-checklist)

---

## Architecture Overview

Anti-scraping systems detect bots across **four dimensions**:

| Dimension | What they check | Your mitigation |
|-----------|----------------|-----------------|
| **Origin** | IP address, ASN, datacenter vs residential | Proxy rotation, residential IPs |
| **Appearance** | HTTP headers, TLS fingerprint, browser fingerprint | Fingerprint-suite, realistic headers, proper TLS |
| **Target** | Which endpoints you hit, API vs HTML | Prefer APIs, vary page types |
| **Behavior** | Request timing, mouse movement, navigation patterns | Random delays, human-like interaction |

You must address **all four** — failing on any one can get you blocked.

---

## Browser Fingerprint Evasion

### What gets fingerprinted

- **Canvas rendering** — draw operations produce hardware-specific hashes
- **WebGL** — renderer string, vendor, shader precision
- **Audio context** — oscillator output varies by hardware
- **Navigator properties** — `navigator.webdriver`, `navigator.plugins`, `navigator.languages`
- **Screen** — resolution, color depth, device pixel ratio
- **Fonts** — installed font enumeration via measurement techniques
- **Timezone** — `Intl.DateTimeFormat` locale

### Crawlee's fingerprint-suite

Crawlee uses **fingerprint-suite** (4 npm packages) which generates statistically realistic fingerprints using Bayesian generative networks trained on real browser traffic:

- `header-generator` — realistic HTTP headers
- `fingerprint-generator` — full browser fingerprint (canvas, WebGL, audio, navigator)
- `fingerprint-injector` — injects fingerprints into Playwright/Puppeteer
- `generative-bayesian-network` — statistical model for realistic combinations

**Fingerprints are enabled by default** in `PlaywrightCrawler` and `PuppeteerCrawler`. Customize when needed:

```javascript
import { PlaywrightCrawler } from 'crawlee';
import { BrowserName, DeviceCategory } from 'fingerprint-generator';

const crawler = new PlaywrightCrawler({
    browserPoolOptions: {
        useFingerprints: true,
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: [BrowserName.firefox],
                devices: [DeviceCategory.desktop],
                operatingSystems: ['windows', 'macos'],
                locales: ['en-US', 'en-GB'],
            },
        },
    },
    // ... handlers
});
```

### Key launch arguments

```javascript
launchOptions: {
    args: [
        '--disable-blink-features=AutomationControlled',  // removes automation flag
    ],
}
```

---

## Stealth Plugins & Configuration

### Option 1: Crawlee built-in (recommended)

Crawlee's default stealth is generally stronger than third-party plugins. Just use `PlaywrightCrawler` with defaults — fingerprints, headers, and basic evasion are automatic.

### Option 2: playwright-extra + stealth plugin

```javascript
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

const crawler = new PlaywrightCrawler({
    launchContext: {
        launcher: chromium,
        launchOptions: { headless: true },
    },
    requestHandler: async ({ page, request }) => {
        // your scraping logic
    },
});
```

### Option 3: Camoufox (best for Cloudflare)

Camoufox is a custom Firefox build purpose-built for anti-detection. It's the **recommended approach for Cloudflare-protected sites**. Use the "Crawlee + Playwright + Camoufox" template on Apify.

### Browser choice matters

| Browser | Stealth level | Notes |
|---------|--------------|-------|
| **Firefox (Camoufox)** | ★★★★★ | Best anti-detection, native Playwright support |
| **Firefox (standard)** | ★★★★ | Less common for scraping = less targeted by detection |
| **Chromium** | ★★★ | Most fingerprinted, but best plugin ecosystem |
| **Brave** | ★★★★ | Built-in anti-fingerprinting, configurable with Playwright |
| **WebKit** | ★★★ | Least tested by anti-bot systems |

**Tip:** Try Firefox first. Chromium is the most heavily targeted by anti-bot systems because most scrapers use it.

---

## Proxy Rotation Strategies

### Proxy types (ranked by quality)

1. **Residential proxies** — Real ISP IPs, highest trust score, most expensive. **Required for Cloudflare.**
2. **ISP/Static residential** — Datacenter-hosted but registered to ISPs. Good balance.
3. **Mobile proxies** — Highest trust but expensive and slow.
4. **Datacenter proxies** — Cheapest, easily detected by sophisticated systems.

### Configuration in Crawlee

```javascript
import { Actor } from 'apify';

// Residential proxies (recommended for protected sites)
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',  // match target audience
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    // ...
});
```

### Sticky sessions

Use sticky sessions to maintain the same IP across related requests (e.g., login → browse → scrape):

```javascript
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

// Crawlee's SessionPool handles this automatically —
// each session gets a consistent proxy IP
```

### Best practices

- **Rotate per session, not per request** — rapid IP changes are suspicious
- **Match geo to target** — US site? Use US proxies
- **Let IPs "heal"** — don't burn IPs with aggressive scraping, then reuse them immediately
- **Monitor success rate** — if below 10%, switch proxy provider or type
- **Use SessionPool** — it automatically retires bad IPs and preserves working ones

---

## Request Patterns & Human-Like Behavior

### Randomized delays

```javascript
const crawler = new PlaywrightCrawler({
    maxRequestsPerMinute: 20,  // throttle globally
    requestHandler: async ({ page, request }) => {
        // Random delay between 1-5 seconds before actions
        await page.waitForTimeout(1000 + Math.random() * 4000);
        
        // your scraping logic
    },
});
```

### Human-like navigation

- **Don't paginate sequentially** (page 1 → 2 → 3 → ... → 100). Mix in category pages, homepages, about pages.
- **Visit non-data pages** occasionally to blend in.
- **Vary request intervals** — don't be perfectly periodic.
- **Add mouse movements and clicks** on elements (not just data extraction).

```javascript
// Simulate human-like mouse movement
await page.mouse.move(
    100 + Math.random() * 500,
    100 + Math.random() * 400,
    { steps: 10 + Math.floor(Math.random() * 20) }
);

// Random scroll
await page.evaluate(() => {
    window.scrollBy(0, 300 + Math.random() * 700);
});
await page.waitForTimeout(500 + Math.random() * 1500);
```

### Concurrency

- **Lower concurrency = harder to detect**. Start with `maxConcurrency: 1-3` for protected sites.
- Use `AutoscaledPool` to dynamically adjust based on success rate.

---

## Header Management

Crawlee's `got-scraping` and fingerprint-suite handle headers automatically, but understand what matters:

### Critical headers

- **User-Agent** — Must match the browser you're emulating. Crawlee handles this.
- **Accept-Language** — Should match proxy geo (e.g., `en-US,en;q=0.9` for US proxy).
- **Accept** — Must be realistic for the resource type.
- **Referer** — Should make navigational sense (don't hit page 5 with no referer).
- **sec-ch-ua** / **sec-ch-ua-platform** — Client hints must match fingerprint.

### Header consistency

Anti-bot systems check that header **combinations** are consistent. A Chrome User-Agent with Firefox-specific headers is an instant flag.

Crawlee's fingerprint-suite ensures consistency automatically. If you override headers manually, ensure they match your browser fingerprint.

### For HTTP-only crawlers (no browser)

Use `got-scraping` or `curl-impersonate` (native TLS) instead of plain HTTP libraries:

```javascript
// got-scraping generates realistic headers automatically
import { gotScraping } from 'got-scraping';

const response = await gotScraping({
    url: 'https://example.com',
    headerGeneratorOptions: {
        browsers: ['chrome'],
        locales: ['en-US'],
        operatingSystems: ['windows'],
    },
});
```

For even better TLS fingerprinting, use `Playwright.request` or `node-libcurl` (curl-impersonate) which have native code for proper TLS cipher ordering.

---

## Cloudflare / Akamai / PerimeterX Bypass

### Cloudflare detection methods

**Server-side:**
- IP reputation and ASN checks
- Header anomalies
- TLS fingerprint (JA3/JA4) mismatches

**Client-side:**
- JavaScript challenges and browser fingerprinting (canvas, fonts, WebGL)
- Mouse movement tracking on Turnstile checkbox
- Cookie and local storage verification

**AI Labyrinth** — serves fake pages to waste AI crawler resources.

### Recommended Cloudflare bypass stack

```
Camoufox + Crawlee PlaywrightCrawler + Residential Proxies
```

This is the most reliable combination. Without residential proxies, even Camoufox will fail because datacenter IPs trigger server-side blocks before browser checks run.

### Bypass recipe

```javascript
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import { Actor } from 'apify';

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 10,           // retry blocked requests
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxErrorScore: 1,        // rotate session after any error
        },
    },
    browserPoolOptions: {
        useFingerprints: true,
    },
    requestHandler: async ({ page, request, log }) => {
        // Wait for Cloudflare challenge to resolve
        await page.waitForTimeout(5000 + Math.random() * 3000);
        
        // Check if we passed
        const title = await page.title();
        if (title.includes('Just a moment') || title.includes('Attention Required')) {
            throw new Error('Cloudflare challenge not passed');
        }
        
        // Scrape data
        const html = await page.content();
        log.info(`Successfully scraped: ${request.url}`);
    },
});
```

### Akamai / PerimeterX

Similar principles apply but these systems are more sensitive to:
- **Akamai**: Sensor data collection (mouse, keyboard, touch events). Add realistic interaction.
- **PerimeterX**: Heavy JavaScript challenges. Use full browser with stealth, avoid headless detection.

### General tips for all anti-bot systems

- **Non-headless mode** can help: `headless: false` (or `'new'` for Chromium's new headless)
- **Increase retries**: `maxRequestRetries: 10` — even 10% success rate is viable
- **Try different browsers** — if Chromium fails, try Firefox or WebKit
- **Consider HTTP-only** — sometimes anti-bot is stricter for browsers than plain HTTP with correct headers
- **Extract from APIs** — internal/mobile APIs are often less protected
- **Reverse-engineer JS challenges** — advanced but powerful for persistent targets

---

## Cookie & Session Management

### Crawlee SessionPool

SessionPool automatically manages cookies and sessions:

```javascript
const crawler = new PlaywrightCrawler({
    useSessionPool: true,  // enabled by default
    sessionPoolOptions: {
        maxPoolSize: 100,
        sessionOptions: {
            maxAgeSecs: 3600,      // session lifetime
            maxUsageCount: 50,     // max requests per session
            maxErrorScore: 3,      // errors before retirement (use 1 for strict sites)
        },
    },
});
```

### How it works

- Each session gets a unique proxy IP + browser fingerprint + cookie jar
- Successful sessions are preserved and reused
- Failed sessions are retired and replaced
- Over time, the pool converges on working configurations

### Login/authenticated scraping

```javascript
requestHandler: async ({ page, session, request }) => {
    // Check if session is authenticated
    if (!session.userData.isLoggedIn) {
        await page.goto('https://example.com/login');
        await page.fill('#username', 'user');
        await page.fill('#password', 'pass');
        await page.click('#submit');
        await page.waitForNavigation();
        session.userData.isLoggedIn = true;
    }
    
    // Now scrape with authenticated session
    await page.goto(request.url);
}
```

---

## Crawlee-Specific Anti-Detection Features

### SessionPool

- Manages proxy IP ↔ fingerprint ↔ cookie consistency
- Auto-retires blocked sessions, preserves working ones
- `maxErrorScore: 1` for aggressive rotation on protected sites

### AutoscaledPool

- Dynamically adjusts concurrency based on system load and success rate
- Prevents overloading target servers
- Configure via `autoscaledPoolOptions`

### Request retries

```javascript
const crawler = new PlaywrightCrawler({
    maxRequestRetries: 10,  // default is 3, increase for protected sites
});
```

### ProxyConfiguration

```javascript
// Tiered proxy setup
const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: [
        'http://user:pass@residential1.proxy.com:8080',
        'http://user:pass@residential2.proxy.com:8080',
    ],
});
```

### got-scraping (for HTTP crawlers)

Crawlee's default HTTP backend generates realistic headers and handles TLS fingerprinting better than standard Node.js HTTP libraries. For even better results, use `curl-impersonate` via `node-libcurl`.

### Browser pool

- Manages browser instances across sessions
- Automatic fingerprint injection per browser
- Supports Chromium, Firefox, WebKit simultaneously

---

## Common Detection Vectors

| Vector | How they detect | How to avoid |
|--------|----------------|--------------|
| `navigator.webdriver` | Set to `true` in automation | Stealth plugin / Camoufox removes it |
| TLS fingerprint (JA3/JA4) | Node.js HTTP ≠ real browser | Use real browser or curl-impersonate |
| Header order | Bots often have wrong header order | Use got-scraping or browser |
| Canvas hash | Consistent across runs = bot | Fingerprint-suite randomizes |
| WebGL renderer | Headless has no GPU | Fingerprint injection |
| Timezone mismatch | Browser timezone ≠ proxy geo | Set timezone to match proxy location |
| DNS leaks | Browser DNS ≠ proxy | Route all traffic through proxy |
| Missing plugins | Real browsers have plugins | Fingerprint-suite injects fake plugin list |
| Honeypot links | CSS-hidden links only bots click | Check `visibility`, `display`, `opacity` before clicking |
| Consistent timing | Perfectly periodic = bot | Random delays, jitter |
| Sequential pagination | 1→2→3→...→100 | Mix page types, random order |

---

## Complete Example

Full Crawlee + Playwright scraper with all anti-detection measures:

```javascript
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { Actor } from 'apify';

await Actor.init();

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    
    // Anti-detection: retries & sessions
    maxRequestRetries: 10,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxErrorScore: 1,
            maxAgeSecs: 3600,
        },
    },
    
    // Anti-detection: fingerprints
    browserPoolOptions: {
        useFingerprints: true,
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: ['firefox'],
                devices: ['desktop'],
                operatingSystems: ['windows', 'macos'],
                locales: ['en-US'],
            },
        },
    },
    
    // Anti-detection: rate limiting
    maxRequestsPerMinute: 20,
    maxConcurrency: 3,
    
    // Use Firefox (less targeted than Chromium)
    launchContext: {
        launchOptions: {
            headless: true,
        },
    },
    
    // Pre-navigation hook for human-like behavior
    preNavigationHooks: [
        async ({ page }) => {
            // Random delay before each navigation
            await page.waitForTimeout(1000 + Math.random() * 3000);
        },
    ],
    
    requestHandler: async ({ page, request, log, session }) => {
        // Wait for page to fully load + Cloudflare challenge
        await page.waitForTimeout(3000 + Math.random() * 2000);
        
        // Check for blocks
        const title = await page.title();
        if (title.includes('Just a moment') || title.includes('Access denied')) {
            session.retire();
            throw new Error(`Blocked on ${request.url}`);
        }
        
        // Human-like: random scroll
        await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 500));
        await page.waitForTimeout(500 + Math.random() * 1000);
        
        // Extract data
        const data = await page.evaluate(() => {
            // your extraction logic
            return { title: document.title, url: location.href };
        });
        
        await Dataset.pushData(data);
        log.info(`Scraped: ${request.url}`);
    },
    
    failedRequestHandler: async ({ request, log }) => {
        log.error(`Failed after retries: ${request.url}`);
    },
});

await crawler.run([
    'https://example.com/page1',
    'https://example.com/page2',
]);

await Actor.exit();
```

---

## Quick Checklist

Before deploying a scraper against a protected site:

- [ ] **Residential proxies** configured and geo-matched
- [ ] **Firefox or Camoufox** (not Chromium) for heavily protected sites
- [ ] **Fingerprints enabled** (default in Crawlee, verify not disabled)
- [ ] **`maxRequestRetries: 10`** and **`maxErrorScore: 1`**
- [ ] **Random delays** between requests (1-5s)
- [ ] **Low concurrency** (1-3) initially, scale up if stable
- [ ] **Session pool** enabled with reasonable `maxAgeSecs` / `maxUsageCount`
- [ ] **Check for blocks** in request handler (title, status code, content)
- [ ] **Headers consistent** with browser fingerprint
- [ ] **Timezone matches** proxy geo
- [ ] **No honeypot links** — check CSS visibility before following links
- [ ] **Consider APIs** — check network tab for less-protected data endpoints
- [ ] **Test incrementally** — start with 1 request, verify success, then scale

---

## References

- [Apify Anti-Scraping Academy](https://docs.apify.com/academy/anti-scraping)
- [Crawlee Documentation](https://crawlee.dev/)
- [Fingerprint Suite](https://github.com/apify/fingerprint-suite)
- [Camoufox](https://camoufox.com/)
- [Bypass Cloudflare Guide](https://blog.apify.com/bypass-cloudflare/)
- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
