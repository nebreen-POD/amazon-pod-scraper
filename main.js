
import { PlaywrightCrawler, Dataset, log } from 'crawlee';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simple N-gram extractor
function extractNGrams(text, n = 2) {
    const tokens = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
    const ngrams = [];
    for (let i = 0; i < tokens.length - n + 1; i++) {
        ngrams.push(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
}

const START_URLS = [
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9056987011', label: 'women' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9056923011', label: 'men' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9057040011', label: 'girls' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9057094011', label: 'boys' }
];

const MAX_PAGES = 5;

const crawler = new PlaywrightCrawler({
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 60,
    async requestHandler({ page, request, enqueueLinks, log }) {
        log.info(`Scraping ${request.url}`);

        // Handle Amazon 429 rate limit
        if (page.status() === 429) {
            log.warning(`Got 429 on ${request.url}, backing off`);
            await sleep(5000);
            throw new Error('Retry due to 429');
        }

        const titles = await page.$$eval('div.p13n-sc-uncoverable-faceout span._cDEzb_p13n-sc-css-line-clamp-3_g3dy1',
            els => els.map(el => el.textContent.trim()));

        for (const title of titles) {
            const unigrams = extractNGrams(title, 1);
            const bigrams = extractNGrams(title, 2);
            const trigrams = extractNGrams(title, 3);
            await Dataset.pushData({
                category: request.userData.label,
                title,
                unigrams,
                bigrams,
                trigrams
            });
        }

        const pageMatch = request.url.match(/page=(\d+)/);
        const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;

        if (currentPage < MAX_PAGES) {
            const nextUrl = `${request.url.split('?')[0]}?page=${currentPage + 1}`;
            await enqueueLinks({ urls: [nextUrl], userData: { label: request.userData.label } });
        }
    },
    failedRequestHandler({ request }) {
        log.error(`Request ${request.url} failed after max retries.`);
    }
});

await crawler.run(START_URLS.map(start => ({ url: start.url, userData: { label: start.label } })));
