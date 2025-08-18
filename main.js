import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const startUrls = [
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9056923011', label: 'WOMEN' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9056987011', label: 'MEN' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9057040011', label: 'GIRLS' },
    { url: 'https://www.amazon.com/gp/bestsellers/fashion/9057094011', label: 'BOYS' }
];

const crawler = new PlaywrightCrawler({
    requestHandler: async ({ request, page, enqueueLinks, log }) => {
        log.info(`Scraping ${request.url} [${request.label}]`);

        // Extract product data
        const products = await page.$$eval('.zg-grid-general-faceout', items => {
            return items.map(item => {
                const titleEl = item.querySelector('.p13n-sc-truncate, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1');
                const linkEl = item.querySelector('a.a-link-normal');
                const imgEl = item.querySelector('img');

                return {
                    title: titleEl ? titleEl.textContent.trim() : null,
                    url: linkEl ? linkEl.href : null,
                    image: imgEl ? imgEl.src : null,
                };
            });
        });

        for (const product of products) {
            await Actor.pushData({
                category: request.label,
                ...product
            });
        }
    },
    maxRequestsPerCrawl: 50,
});

await crawler.run(startUrls);

await Actor.exit();
