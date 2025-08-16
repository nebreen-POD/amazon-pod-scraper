# Apify Actor with Playwright + Chrome
FROM apify/actor-node-playwright-chrome:20

COPY . ./

RUN npm install --omit=dev

CMD ["node", "main.js"]
