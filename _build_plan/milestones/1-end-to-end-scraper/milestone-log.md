## What's new in the app

- Run `node scrape.js <collection-or-product-url> [output.csv]` to scrape a Fynd storefront and get back one complete CSV.
- Point it at a `/product/<slug>` URL to scrape a single product, or at a collection URL to scrape every product across all pages of that collection.
- Each row includes name, SKU, UID, price, MRP, brand, description, short description, URL, the full ordered image gallery, and every attribute the site exposes for that product (color, fabric, country of origin, gender, sizes, delivery timelines, customization notes, etc.).
- The CSV only ever contains real data pulled from the site — missing fields are left blank, never guessed or filled in.
- Progress prints to the console as it runs: which collection page is being fetched, each product's name and image count as it's scraped, and a final summary of how many rows were written and where.

## What was built

Nothing new — `scrape.js` and `scrape.test.js` already existed in the repo (written prior to this PRD process) and were verified line-by-line against every milestone-1 requirement:

- URL router (`main()`): detects `/product/` vs. collection URLs.
- Embedded JSON extractor (`extractAppData`): brace-matches `window.APP_DATA`, converts bare `undefined` to `null`, then `JSON.parse`s.
- Collection pagination crawler (`collectCollectionSlugs`): walks `?page_no=N` until `page.has_next` is false.
- Product detail scraper (`fetchProductDetails`, `buildRow`): pulls name, SKU (`item_code`), UID, price (effective/marked), brand, description, short description, every `attributes` key, every `grouped_attributes` group (flattened via `flattenGroup`), and the ordered image list from `media`.
- Dynamic CSV builder (`writeCsv`): 9 fixed columns, then `Image 1..N` padded to the widest gallery in that run, then attribute keys alphabetized, then grouped-attribute (group) keys alphabetized as a separate block.
- Progress logging: present in `main()` exactly as specced.

## Decisions made during this milestone (not pre-specified in the PRD)

- **Fixed columns**: confirmed with the user to keep the existing 9 fixed columns (Name, SKU, UID, Price, MRP, Brand, Description, Short Description, URL) rather than restricting to just name/SKU/price/URL.
- **Attribute ordering**: confirmed with the user to keep attribute keys and grouped-attribute keys as two separate alphabetized blocks rather than merging them into one combined alphabetized list.

## Verification performed

- `node scrape.test.js` → "All checks passed." (extraction, `undefined`→`null`, CSV escaping, `val()`, `flattenGroup()`).
- Live run against a real product URL (`isabydollywahal.com/product/bella-gold-lehenga-13956629`) → 1 row, 13 images, correct logging.
- Live run against a real collection URL (`isabydollywahal.com/collection/fiza`) → walked 2 pages, found 23 products, wrote 23 rows.
- Verified in the resulting CSV: correct row count (23), image columns padded to the widest gallery (13) with genuine blanks for narrower galleries (e.g. a 5-image product has blank `Image 6..13`), no attribute column appears unless at least one product actually has that key (e.g. `custom-attribute-6` correctly absent), and attribute keys observed on real product pages (`product_details`, `sizes`, `brand`, etc. as attribute-dict keys) are legitimate seller-configured Fynd attributes, not a scraping artifact.

No code changes were required — the existing implementation already satisfied milestone 1 in full.

## What milestone 2 needs to know

- Product scraping in `main()` currently uses a plain sequential `for` loop over `slugs` calling `fetchProductDetails` one at a time — this is the loop to parallelize to a concurrency of 5.
- Nothing about the CSV output, column layout, or logging format should change — milestone 2 only changes how fetching is scheduled, not what gets written or logged (per-product log lines should still print as each product completes, in whatever order they finish).
- `fetchHtml`, `extractAppData`, `fetchProductDetails`, and `buildRow` are all pure/stateless and safe to call concurrently as-is.
