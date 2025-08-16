
import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Simple n-gram generator
function generateNgrams(words, n) {
    let ngrams = [];
    for (let i = 0; i <= words.length - n; i++) {
        ngrams.push(words.slice(i, i + n).join(' '));
    }
    return ngrams;
}

await Actor.main(async () => {
    const input = await Actor.getInput();
    const { keywords, pagesPerKeyword = 1, maxItems = 50 } = input;

    const results = [];
    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: maxItems,
        requestHandler: async ({ page, request }) => {
            const items = await page.$$eval('div.s-main-slot div[data-asin]', (elements) => {
                return elements.map(el => {
                    const titleEl = el.querySelector('h2 a span');
                    const asin = el.getAttribute('data-asin');
                    const title = titleEl ? titleEl.innerText.trim() : null;
                    return { asin, title };
                });
            });

            for (const { asin, title } of items) {
                if (!asin || !title) continue;
                const tokens = title.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, '')
                    .split(/\s+/)
                    .filter(t => t.length > 2);

                // Generate n-grams (1 to 3 words)
                const ngrams = [
                    ...generateNgrams(tokens, 1),
                    ...generateNgrams(tokens, 2),
                    ...generateNgrams(tokens, 3)
                ];

                results.push({
                    keywordSearch: request.userData.keyword,
                    asin,
                    title,
                    tokens,
                    ngrams: Array.from(new Set(ngrams)) // unique n-grams
                });
            }
        }
    });

    for (const keyword of keywords) {
        for (let p = 1; p <= pagesPerKeyword; p++) {
            await crawler.addRequests([{
                url: `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&page=${p}`,
                userData: { keyword }
            }]);
        }
    }

    await crawler.run();

    await Actor.pushData(results);
});
