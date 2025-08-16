import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import _ from 'lodash';
import natural from 'natural';

await Actor.init();

const input = await Actor.getInput() || {};
const { startUrls = [], maxPages = 5, ngramSize = 2 } = input;

// Helper: N-gram extraction
function extractNgrams(text, n = 2) {
    if (!text) return [];
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(text.toLowerCase());
    const grams = natural.NGrams.ngrams(tokens, n);
    return grams.map(g => g.join(' '));
}

// PlaywrightCrawler setup
const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages, // <- corrected here
    requestHandler: async ({ page, request, log, enqueueLinks }) => {
        log.info(`Scraping ${request.url}`);

        const products = await page.$$eval('div[data-asin]', (items) =>
            items.map(el => {
                const title = el.querySelector('h2 a span')?.innerText?.trim();
                const price = el.querySelector('.a-price .a-offscreen')?.innerText?.trim();
                const rating = el.querySelector('.a-icon-alt')?.innerText?.trim();
                const reviews = el.querySelector('.s-link-style .s-underline-text')?.innerText?.trim();
                return { title, price, rating, reviews };
            })
        );

        // Process with n-grams
        const processed = products.map(p => ({
            ...p,
            ngrams: extractNgrams(p.title, ngramSize),
        }));

        await Actor.pushData(processed);

        // Follow pagination (no maxRequestsPerCrawl here)
        await enqueueLinks({
            selector: 'a.s-pagination-next',
        });
    },
});

// Add starting URLs
await crawler.addRequests(startUrls);
await crawler.run();

await Actor.exit();
