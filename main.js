import { PlaywrightCrawler } from 'crawlee';
import * as Apify from 'apify';

function generateNgrams(tokens, n) {
    const ngrams = [];
    for (let i = 0; i <= tokens.length - n; i++) {
        ngrams.push(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
}

Apify.main(async () => {
    const input = await Apify.getInput() || {};
    const categoryUrls = input.categoryUrls || [
        { category: "men", url: "https://www.amazon.com/s?k=novelty+tshirts+men" },
        { category: "women", url: "https://www.amazon.com/s?k=novelty+tshirts+women" },
        { category: "boys", url: "https://www.amazon.com/s?k=novelty+tshirts+boys" },
        { category: "girls", url: "https://www.amazon.com/s?k=novelty+tshirts+girls" }
    ];

    const results = {};

    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 40, // 10 pages x 4 categories
        requestHandler: async ({ request, page, enqueueLinks }) => {
            const category = request.userData.category;

            const products = await page.$$eval('div.s-main-slot div[data-asin]', items => {
                return items.map(el => {
                    const title = el.querySelector('h2 a span')?.innerText || '';
                    const link = el.querySelector('h2 a')?.href || '';
                    const price = el.querySelector('.a-price span.a-offscreen')?.innerText || '';
                    const rating = el.querySelector('.a-icon-alt')?.innerText || '';
                    return { title, link, price, rating };
                });
            });

            if (!results[category]) {
                results[category] = { products: [], unigrams: {}, bigrams: {}, trigrams: {} };
            }

            for (const product of products) {
                results[category].products.push(product);
                const tokens = product.title.toLowerCase().split(/\s+/).filter(t => t.length > 2);

                // Unigrams
                tokens.forEach(w => results[category].unigrams[w] = (results[category].unigrams[w] || 0) + 1);

                // Bigrams
                generateNgrams(tokens, 2).forEach(bg => results[category].bigrams[bg] = (results[category].bigrams[bg] || 0) + 1);

                // Trigrams
                generateNgrams(tokens, 3).forEach(tg => results[category].trigrams[tg] = (results[category].trigrams[tg] || 0) + 1);
            }

            await enqueueLinks({
                selector: 'a.s-pagination-next',
                userData: { category }
            });
        }
    });

    for (const { category, url } of categoryUrls) {
        await crawler.addRequests([{ url, userData: { category } }]);
    }

    await crawler.run();

    // Convert maps to sorted arrays
    const finalResults = [];
    for (const [category, data] of Object.entries(results)) {
        const formatNgrams = (obj) =>
            Object.entries(obj)
                .sort((a, b) => b[1] - a[1])
                .map(([phrase, count]) => ({ phrase, count }));

        finalResults.push({
            category,
            products: data.products,
            unigrams: formatNgrams(data.unigrams),
            bigrams: formatNgrams(data.bigrams),
            trigrams: formatNgrams(data.trigrams)
        });
    }

    await Apify.pushData(finalResults);
});
