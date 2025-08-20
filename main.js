import { PlaywrightCrawler, log } from 'crawlee';
import { Actor } from 'apify';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}
function abs(base, href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return new URL(href, 'https://www.amazon.com').toString();
  try { return new URL(href, base).toString(); } catch { return null; }
}

await Actor.main(async () => {
  const input = await Actor.getInput() || {};
  const categoryUrls = input.categoryUrls || [
    { category: "women", url: "https://www.amazon.com/gp/bestsellers/fashion/9056923011" },
    { category: "men",   url: "https://www.amazon.com/gp/bestsellers/fashion/9056987011" },
    { category: "girls", url: "https://www.amazon.com/gp/bestsellers/fashion/9057040011" },
    { category: "boys",  url: "https://www.amazon.com/gp/bestsellers/fashion/9057094011" }
  ];
  const pagesPerCategory = Math.min(Math.max(input.pagesPerCategory ?? 5, 1), 5);
  const useApifyProxy = input.useApifyProxy ?? true;
  const proxyGroups = input.proxyGroups || ['RESIDENTIAL'];
  const maxBackoffMs = input.maxBackoffMs ?? 60000;

  const proxyConfiguration = await Actor.createProxyConfiguration(
    useApifyProxy ? { useApifyProxy: true, groups: proxyGroups } : undefined
  );

  const agg = {}; // {cat: {products:[], uni:{}, bi:{}, tri:{}, pages:0}}

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: 1,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { maxPoolSize: 5 },
    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 60,

    preNavigationHooks: [async ({ page }, gotoOptions) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      await page.setUserAgent(pickUA());
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
      });
      gotoOptions.waitUntil = 'domcontentloaded';
    }],

    // ✅ Handle 429 using response.status() here
    postNavigationHooks: [async ({ request, response, log }) => {
      if (response && response.status() === 429) {
        const attempt = request.userData.backoffAttempt || 0;
        const delay = Math.min(maxBackoffMs, Math.floor((2 ** attempt) * 3000 + Math.random() * 1500));
        log.warning(`429 for ${request.url}. Backoff ${delay}ms (attempt ${attempt + 1}).`);
        await sleep(delay);
        request.userData.backoffAttempt = attempt + 1;
        await Actor.addRequests([{ url: request.url, userData: request.userData, forefront: true }]);
        throw new Error('BACKOFF_RETRY');
      }
    }],

    async requestHandler({ request, page, log }) {
      const category = request.userData?.category || 'unknown';
      if (!agg[category]) agg[category] = { products: [], uni: {}, bi: {}, tri: {}, pages: 0 };
      if (agg[category].pages >= pagesPerCategory) return;

      await sleep(800 + Math.floor(Math.random() * 700));

      const cards = await page.$$eval(
        '.zg-grid-general-faceout, .p13n-grid-content, .a-carousel-card, div.p13n-sc-uncoverable-faceout, div.s-main-slot div[data-asin]',
        (nodes) => {
          const out = [];
          for (const n of nodes) {
            const titleEl = n.querySelector('h2 a span, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, .p13n-sc-truncate, .a-size-base-plus.a-color-base.a-text-normal');
            const linkEl  = n.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
            const priceEl = n.querySelector('.a-price .a-offscreen');
            const ratingEl= n.querySelector('.a-icon-alt');
            const title = titleEl?.textContent?.trim() || null;
            const href  = linkEl?.getAttribute('href') || null;
            const link  = href || null;
            const price = priceEl?.textContent?.trim() || null;
            const rating= ratingEl?.textContent?.trim() || null;
            if (title && link) out.push({ title, link, price, rating });
          }
          return out;
        }
      );

      for (const p of cards) {
        const fullLink = abs(request.url, p.link);
        agg[category].products.push({ ...p, link: fullLink });
        const toks = tokenize(p.title);
        for (const w of toks) agg[category].uni[w] = (agg[category].uni[w] || 0) + 1;
        for (const bg of ngrams(toks, 2)) agg[category].bi[bg] = (agg[category].bi[bg] || 0) + 1;
        for (const tg of ngrams(toks, 3)) agg[category].tri[tg] = (agg[category].tri[tg] || 0) + 1;
      }

      agg[category].pages += 1;

      const nextHref = await page.$eval('li.a-last a, a.a-last', el => el.getAttribute('href')).catch(() => null);
      if (nextHref && agg[category].pages < pagesPerCategory) {
        const nextUrl = abs(request.url, nextHref);
        if (nextUrl) {
          await Actor.addRequests([{ url: nextUrl, userData: { category, backoffAttempt: 0 } }]);
        }
      } else {
        log.info(`[${category}] Stop pagination: pages=${agg[category].pages}/${pagesPerCategory}, hasNext=${!!nextHref}`);
      }
    },

    failedRequestHandler: async ({ request, error }) => {
      log.warning(`Failed: ${request.url} | ${error?.message || error}`);
    },
  });

  await crawler.addRequests(categoryUrls.map(c => ({ url: c.url, userData: { category: c.category, backoffAttempt: 0 } })));

  await crawler.run();

  const format = (obj) => Object.entries(obj).sort((a,b) => b[1]-a[1]).map(([phrase,count]) => ({ phrase, count }));
  const output = Object.entries(agg).map(([category, data]) => ({
    category,
    pagesCrawled: data.pages,
    products: data.products,
    unigrams: format(data.uni),
    bigrams:  format(data.bi),
    trigrams: format(data.tri),
  }));

  await Actor.pushData(output);
});
