// Self-check for the universal (Shopify/WooCommerce/custom-site) extraction logic.
// Run: node universal-scraper.test.js
const assert = require('assert');
const { extractProducts, discoverLinks, shopifyRow, wooRow, canonical } = require('./universal-scraper.js');

// 1. canonical() strips hash and tracking params, normalizes trailing slash
assert.strictEqual(canonical('https://example.com/products/a/?utm_source=x&gclid=y#reviews'), 'https://example.com/products/a');
assert.strictEqual(canonical('https://example.com/'), 'https://example.com/');

// 2. shopifyRow() maps a Shopify product-JSON payload to a row, preferring the available variant
const shopifyProduct = {
  id: 1, title: 'Tee', vendor: 'Acme', product_type: 'Shirts', tags: ['sale', 'new'],
  variants: [{ sku: 'A1', price: '10.00', available: false }, { sku: 'A2', price: '12.00', compare_at_price: '15.00', available: true }],
  images: ['/img1.jpg'], handle: 'tee', available: true,
};
const sRow = shopifyRow(shopifyProduct, 'https://shop.example.com/', 'USD');
assert.strictEqual(sRow.name, 'Tee');
assert.strictEqual(sRow.sku, 'A2'); // picks the available variant, not the first
assert.strictEqual(sRow.price, 12);
assert.strictEqual(sRow.mrp, 15);
assert.strictEqual(sRow.images[0], 'https://shop.example.com/img1.jpg');
assert.strictEqual(sRow.attributes.Availability, 'In stock');

// 3. wooRow() maps a WooCommerce Store API product to a row and scales minor-unit prices
const wooProduct = {
  id: 2, name: 'Mug', sku: 'M-1', permalink: 'https://shop.example.com/product/mug/',
  prices: { price: '1500', regular_price: '2000', currency_code: 'USD', currency_minor_unit: 2 },
  brands: [{ name: 'Acme' }], images: [{ src: 'https://shop.example.com/mug.jpg' }], is_in_stock: true,
};
const wRow = wooRow(wooProduct);
assert.strictEqual(wRow.price, 15);
assert.strictEqual(wRow.mrp, 20);
assert.strictEqual(wRow.brand, 'Acme');
assert.strictEqual(wRow.attributes.Availability, 'In stock');

// 4. extractProducts() reads schema.org JSON-LD Product data embedded in a page
const ldHtml = `<html><body><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product', name: 'Lamp', sku: 'L-1',
  brand: { name: 'Acme' }, image: ['https://shop.example.com/lamp.jpg'],
  offers: { '@type': 'Offer', price: '49.99', priceCurrency: 'USD', availability: 'InStock' },
})}</script></body></html>`;
const ldRows = extractProducts(ldHtml, 'https://shop.example.com/products/lamp');
assert.strictEqual(ldRows.length, 1);
assert.strictEqual(ldRows[0].name, 'Lamp');
assert.strictEqual(ldRows[0].price, 49.99);
assert.strictEqual(ldRows[0].attributes.Availability, 'InStock');

// 5. extractProducts() also reads itemprop microdata when no JSON-LD is present
const microHtml = `<div itemtype="http://schema.org/Product">
  <span itemprop="name">Chair</span>
  <span itemprop="sku">C-1</span>
  <span itemprop="price" content="99.00"></span>
  <span itemprop="priceCurrency" content="USD"></span>
</div>`;
const microRows = extractProducts(microHtml, 'https://shop.example.com/products/chair');
assert.strictEqual(microRows.length, 1);
assert.strictEqual(microRows[0].name, 'Chair');
assert.strictEqual(microRows[0].price, 99);

// 6. discoverLinks() finds product links and pagination, and ignores cart/checkout/off-site links
const listHtml = `<html><body>
  <a href="/products/lamp">Lamp</a>
  <a href="/collections/all">All</a>
  <a href="/cart">Cart</a>
  <a href="https://other.example.com/products/x">Off-site</a>
  <a rel="next" href="/collections/all?page=2">Next</a>
</body></html>`;
const links = discoverLinks(listHtml, 'https://shop.example.com/collections/all');
assert.deepStrictEqual(links.products, ['https://shop.example.com/products/lamp']);
assert.deepStrictEqual(links.next, ['https://shop.example.com/collections/all?page=2']);

console.log('All checks passed.');
