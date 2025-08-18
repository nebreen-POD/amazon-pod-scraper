import { PlaywrightCrawler } from 'crawlee';
import { Actor } from 'apify';

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i <= tokens.length - n; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

await Actor.main(async () => {
  const input = await Actor.getInput() || {};
  const categoryUrls = input.categoryUrls || [
    { category: "women", url: "https://www.amazon.com/gp/bestsellers/fashion/9056923011" },
    { category: "men",   url: "https://www.amazon.com/gp/bestsellers/fashion/9056987011" },
    { category: "girls", url: "https://www.amazon.com/gp/bestsellers/fashion/9057040011" },
    { category: "boys",  url: "https://www.amazon.com/gp/bestsellers/fashion/9057094011" }
  ];
  const pagesPerCategory = input.pagesPerCategory ?? 10;

  // Aggregators per category
  const agg = {}; // {cat: {products:[], uni:{}, bi:{}, tri:{}}}

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: pagesPerCategory * categoryUrls.length,
    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 60,
    requestHandler: async ({ request, page, enqueueLinks, log }) => {
      const category = request.userData?.category || 'unknown';
      if (!agg[category]) agg[category] = { products: [], uni: {}, bi: {}, tri: {} };

      // Product cards on Best Sellers pages can use zg-grid or modern faceout
      const products = await page.$$eval('.zg-grid-general-faceout, .p13n-grid-content, .a-carousel-card, .a-section', nodes => {
        const rows = [];
        for (const n of nodes) {
          const titleEl = n.querySelector('._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, .p13n-sc-truncate, h2 a span, .a-size-base-plus.a-color-base.a-text-normal');
          const linkEl  = n.querySelector('a.a-link-normal[href*="/dp/"]') || n.querySelector('a.a-link-normal');
          const priceEl = n.querySelector('.a-price .a-offscreen');
          const ratingEl= n.querySelector('.a-icon-alt');

          const title = titleEl?.textContent?.trim() || null;
          let link = linkEl?.href || null;
          if (link && link.startsWith('/')) link = 'https://www.amazon.com' + link;

          if (title && link) {
            rows.push({
              title,
              link,
              price: priceEl?.textContent?.trim() || null,
              rating: ratingEl?.textContent?.trim() || null,
            });
          }
        }
        return rows;
      });

      for (const p of products) {
        agg[category].products.push(p);
        const toks = tokenize(p.title);
        for (const w of toks) agg[category].uni[w] = (agg[category].uni[w] || 0) + 1;
        for (const bg of ngrams(toks, 2)) agg[category].bi[bg] = (agg[category].bi[bg] || 0) + 1;
        for (const tg of ngrams(toks, 3)) agg[category].tri[tg] = (agg[category].tri[tg] || 0) + 1;
      }

      // Follow pagination next button for up to N pages per category
      await enqueueLinks({
        selector: 'a[href*="zgbs"] ~ ul a:has(span:contains("Next")) , a.a-last a, a.s-pagination-next',
        userData: { category }
      });
    },
  });

  // Seed requests (first page per category)
  await crawler.addRequests(categoryUrls.map(c => ({ url: c.url, userData: { category: c.category } })));

  await crawler.run();

  // Format summary per category
  const format = (obj) => Object.entries(obj).sort((a,b) => b[1]-a[1]).map(([phrase,count]) => ({ phrase, count }));
  const output = Object.entries(agg).map(([category, data]) => ({
    category,
    products: data.products,
    unigrams: format(data.uni),
    bigrams:  format(data.bi),
    trigrams: format(data.tri),
  }));

  await Actor.pushData(output);
});
