#!/usr/bin/env node
// Fynd-platform storefront scraper. Single file, no dependencies.
// Usage: node scrape.js <collection-or-product-url> [output.csv]

const fs = require('fs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Finds `window.APP_DATA = {...}` and returns the parsed object.
// It's a JS literal, not strict JSON: brace-matches (respecting strings)
// and rewrites bare `undefined` tokens to `null` before JSON.parse.
function extractAppData(html) {
  const marker = 'window.APP_DATA';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = html.indexOf('{', markerIdx);
  if (start === -1) return null;

  let depth = 0;
  let inStr = null;
  let esc = false;
  const out = [];
  let i = start;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      out.push(c);
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === inStr) { inStr = null; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out.push(c); continue; }
    if (c === '{') { depth++; out.push(c); continue; }
    if (c === '}') {
      depth--;
      out.push(c);
      if (depth === 0) { i++; break; }
      continue;
    }
    if (c === 'u' && html.startsWith('undefined', i)) {
      const before = html[i - 1] || '';
      const after = html[i + 9] || '';
      if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
        out.push('null');
        i += 8; // 'undefined' is 9 chars, loop's i++ covers the last one
        continue;
      }
    }
    out.push(c);
  }

  return JSON.parse(out.join(''));
}

function slugFromProductUrl(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('product');
  return idx !== -1 ? parts[idx + 1] : parts[parts.length - 1];
}

async function collectCollectionSlugs(collectionUrl, onProgress = () => {}) {
  const slugs = [];
  const seen = new Set();
  let pageNo = 1;
  while (true) {
    const pageUrl = new URL(collectionUrl);
    pageUrl.searchParams.set('page_no', String(pageNo));
    console.log(`Fetching collection page ${pageNo}...`);
    const html = await fetchHtml(pageUrl.toString());
    const appData = extractAppData(html);
    const items = appData?.reduxData?.collection?.item?.items || [];
    let added = 0;
    for (const item of items) if (item?.slug && !seen.has(item.slug)) { seen.add(item.slug); slugs.push(item.slug); added++; }
    onProgress({ phase: 'discovering', page: pageNo, total: slugs.length });
    const page = appData?.reduxData?.collection?.item?.page;
    if (!page || !page.has_next) break;
    if (!added || pageNo >= 200) throw new Error('Collection pagination did not finish. Try a smaller collection.');
    pageNo++;
  }
  return slugs;
}

async function fetchProductDetails(origin, slug) {
  const url = `${origin}/product/${slug}/`;
  const html = await fetchHtml(url);
  const appData = extractAppData(html);
  return { details: appData?.reduxData?.product?.product_details, url };
}

const CONCURRENCY = 5;

// Runs `fn` over `items` with at most `concurrency` in flight at once.
// Returns results in the same order as `items` (not completion order).
async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function scrapeAll(slugs, origin, onProgress = () => {}) {
  let completed = 0;
  let failed = 0;
  const results = await runPool(slugs, CONCURRENCY, async (slug) => {
    try {
      const { details, url } = await fetchProductDetails(origin, slug);
      if (!details) {
        failed++;
        console.log(`  ! ${slug}: no product_details found, skipping`);
        return null;
      }
      const row = buildRow(details, url);
      console.log(`  ${row.name || slug} — ${row.images.length} images`);
      return row;
    } catch (err) {
      failed++;
      console.log(`  ! ${slug}: ${err.message}`);
      return null;
    } finally {
      onProgress({ phase: 'scraping', completed: ++completed, total: slugs.length, failed });
    }
  });
  return results.filter(Boolean);
}

// Normalizes an attribute/grouped-attribute value of unknown shape to a display string.
function val(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(val).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    if ('value' in v) return val(v.value);
    if ('name' in v) return val(v.name);
    return Object.values(v).map(val).filter(Boolean).join('; ');
  }
  return '';
}

function flattenGroup(group) {
  const details = group.details || group.items || [];
  return details
    .map((d) => {
      const label = d.key ?? d.name ?? '';
      const value = val(d.value);
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join('; ');
}

// details.sizes is a single object like { sizes: [...], price: { effective: {min,max}, marked: {min,max} } }
function priceOf(p) {
  if (p === null || p === undefined) return '';
  if (typeof p === 'object') return p.min ?? p.max ?? '';
  return p;
}

function buildRow(details, url) {
  const price = (details.sizes && details.sizes.price) || {};
  const brand =
    typeof details.brand === 'object' && details.brand ? details.brand.name : details.brand;

  const attributes = {};
  for (const [k, v] of Object.entries(details.attributes || {})) attributes[k] = val(v);

  const groups = {};
  for (const g of details.grouped_attributes || []) {
    const title = g.title || g.name;
    if (title) groups[title] = flattenGroup(g);
  }

  const images = (details.media || [])
    .filter((m) => !m.type || m.type === 'image')
    .map((m) => m.url)
    .filter(Boolean);

  return {
    name: details.name || '',
    sku: details.item_code || '',
    uid: details.uid ?? '',
    price: priceOf(price.effective),
    mrp: priceOf(price.marked),
    brand: brand || '',
    description: details.description || '',
    shortDescription: details.short_description || '',
    url,
    images,
    attributes,
    groups,
  };
}

function csvEscape(value) {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  const maxImages = rows.reduce((m, r) => Math.max(m, r.images.length), 0);
  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys(r.attributes)))].sort();
  const groupKeys = [...new Set(rows.flatMap((r) => Object.keys(r.groups)))].sort();

  const fixed = ['Name', 'SKU', 'UID', 'Price', 'MRP', 'Brand', 'Description', 'Short Description', 'URL'];
  const imageCols = Array.from({ length: maxImages }, (_, i) => `Image ${i + 1}`);
  const header = [...fixed, ...imageCols, ...attrKeys, ...groupKeys];

  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const fixedVals = [
      r.name, r.sku, r.uid, r.price, r.mrp, r.brand, r.description, r.shortDescription, r.url,
    ];
    const imageVals = imageCols.map((_, i) => r.images[i] || '');
    const attrVals = attrKeys.map((k) => r.attributes[k] || '');
    const groupVals = groupKeys.map((k) => r.groups[k] || '');
    lines.push([...fixedVals, ...imageVals, ...attrVals, ...groupVals].map(csvEscape).join(','));
  }

  return lines.join('\n') + '\n';
}

function writeCsv(rows, outputPath) {
  fs.writeFileSync(outputPath, rowsToCsv(rows), 'utf8');
}

async function main() {
  const [, , inputUrl, outArg] = process.argv;
  if (!inputUrl) {
    console.error('Usage: node scrape.js <collection-or-product-url> [output.csv]');
    process.exit(1);
  }
  const outputPath = outArg || 'output.csv';
  const parsed = new URL(inputUrl);
  const origin = parsed.origin;

  const slugs = parsed.pathname.includes('/product/')
    ? [slugFromProductUrl(inputUrl)]
    : await collectCollectionSlugs(inputUrl);

  console.log(`Found ${slugs.length} product(s) to scrape.`);

  const rows = await scrapeAll(slugs, origin);

  writeCsv(rows, outputPath);
  console.log(`Wrote ${rows.length} product(s) to ${outputPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  extractAppData,
  csvEscape,
  val,
  flattenGroup,
  buildRow,
  slugFromProductUrl,
  runPool,
  collectCollectionSlugs,
  fetchProductDetails,
  scrapeAll,
  rowsToCsv,
  writeCsv,
};
