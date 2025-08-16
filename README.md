
# Amazon POD Keyword Scraper with N-gram Extraction

This Apify actor scrapes Amazon search results for given keywords and extracts:
- ASIN
- Title
- Tokenized keywords
- N-grams (1-3 words) from titles

## Usage
1. Upload to Apify as a new actor.
2. Build the actor.
3. Run with inputs:
```
{
  "keywords": ["funny cat t shirt", "gardening t shirt"],
  "pagesPerKeyword": 1,
  "maxItems": 50
}
```
4. View results in dataset.
