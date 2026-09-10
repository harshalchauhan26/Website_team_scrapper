# Atelier

A local product-research app with a universal storefront scraper. Browse actual CSV collections, collect new product data from Shopify, WooCommerce, Fynd or custom sites, inspect image galleries and export spreadsheets.

## Start

Requires Node.js 20 or newer. No dependency installation is needed.

```powershell
npm start
```

Open **http://localhost:3000**. To choose a different port, run `node server.js 3001`.

## Using the workspace

- Existing `.csv` files in this folder load automatically when the server starts. Supports the supplied Fynd and Saaksha & Kinni export layouts. Multiple image rows for a product are combined into one product with a gallery.
- Paste one or many store, collection or product URLs (one per line, or load a `.txt` file) to collect a new dataset. Shopify and WooCommerce use their public product APIs, Fynd uses its embedded page state, and custom sites are crawled via structured data (JSON-LD/microdata), sitemap discovery and a headless-browser fallback for JS-rendered pages.
- Open a collection, search names/brands/SKUs, sort by price or name, and switch between grid and table views. Each page displays up to 24 products.
- Click a product for its gallery, description, attributes and original source link.
- Export the entire collection, or check specific products across pages to export only those records. Search filters do not silently change a full export. Image links are exported; image files are not downloaded.
- New collections are saved atomically in `.data/collections.json`. Original CSVs are not modified. Keep a backup of `.data` if you move the app.
- The app remembers its theme, display preference and active job ID in this browser. Refreshing does not interrupt a job while the server stays running. Shutting down the server stops unfinished jobs.
- The library counters sum records and links across snapshots; overlapping collections are not deduplicated across files. Imported prices are snapshots, not verified current prices. Supplied INR exports display rupees; an explicit Currency column takes precedence.
- Remote images load from the source websites and may be unavailable when offline or if the original URL expires.

## Command line and compatibility

```powershell
node scrape.js https://example.com/collection/name output.csv
npm test
npm run check
```

The original `GET /api/scrape?url=...` CSV endpoint is retained. The app adds `GET /api/collections`, `GET /api/collections/:id`, `GET /api/collections/:id/export`, `POST /api/jobs` and `GET /api/jobs/:id`.

The server binds to the loopback interface and is intended for personal use on this computer. It has no multi-user authentication and is not configured for public deployment. Tests exercise request handlers without opening ports, plus CSV import/export, persistence, validation, concurrency and scraper progress using deterministic fixtures. They do not verify external storefront availability or browser rendering.
