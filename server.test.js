const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApp, validateUrl } = require('./server');
const { parseCsv, normalize, loadLibrary } = require('./library');
const { rowsToCsv, collectCollectionSlugs, scrapeAll } = require('./scrape');

// Drive the actual HTTP request handler without opening a network port.
function request(server, pathname, { method = 'GET', body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]);
    Object.assign(req, { url: pathname, method, headers: { host: 'localhost:3000', ...(origin ? { origin } : {}) } });
    const headers = {};
    const res = {
      headersSent: false, status: 200,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      writeHead(status, values) { this.status = status; this.headersSent = true; Object.entries(values).forEach(([k,v]) => this.setHeader(k,v)); },
      end(body = '') { const text = String(body); resolve({status:this.status, headers, text, json:() => JSON.parse(text)}); }
    };
    req.on('error', reject); server.emit('request', req, res);
  });
}
const row = { name:'Silk, "Evening" Dress', sku:'S-1', uid:1, price:1000, mrp:1200, brand:'Example', description:'Line one\nLine two', shortDescription:'', url:'https://example.com/product/silk', images:['https://example.com/a.jpg','https://example.com/b.jpg'], attributes:{Color:'Green'}, groups:{} };
function setup(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-test-'));
  fs.writeFileSync(path.join(root, 'sample.csv'), rowsToCsv([row]));
  const server = createApp({ root, ...opts });
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  return { root, server };
}
test('CSV imports preserve quotes, multiline details, prices and image arrays', () => {
  const records = normalize(parseCsv('\uFEFF' + rowsToCsv([row])));
  assert.equal(records[0].name, row.name); assert.equal(records[0].description, row.description);
  assert.deepEqual(records[0].images, row.images); assert.equal(records[0].price, '1000');
  assert.throws(() => parseCsv('Name\n"unfinished'), /unclosed/);
});
test('repeated image rows are merged into a single product', () => {
  const data = normalize([{ 'Product Name':'Dress','Product URL':row.url,'Image URL':row.images[0] },{ 'Product Name':'Dress','Product URL':row.url,'Image URL':row.images[1] }]);
  assert.equal(data.length,1); assert.deepEqual(data[0].images,row.images);
});
test('spreadsheet exports neutralize formula prefixes', () => {
  const csv = rowsToCsv([{...row,name:'=HYPERLINK("bad")'}]);
  assert.equal(parseCsv(csv)[0].Name, '\'=HYPERLINK("bad")');
});
test('URLs reject local targets, credentials and unsupported protocols', () => {
  for (const url of ['file:///product/a','http://127.0.0.1/product/a','http://localhost/product/a','https://a:b@example.com/product/a','not a url']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl(row.url).hostname,'example.com');
  // The universal scraper crawls custom sites from any path, not just /product or /collection.
  assert.equal(validateUrl('https://example.com/shop').hostname,'example.com');
});
test('library, product details, static assets, export and missing routes', async t => {
  const {server} = setup(t);
  const list = await request(server,'/api/collections'); assert.equal(list.status,200);
  const d = list.json()[0]; assert.equal(d.count,1); assert.equal(d.imageCount,2);
  const detail = (await request(server,'/api/collections/' + d.id)).json(); assert.equal(detail.rows[0].name,row.name);
  const csv = await request(server,`/api/collections/${d.id}/export?rows=0`); assert.equal(csv.status,200); assert.equal(parseCsv(csv.text).length,1);
  assert.equal(parseCsv((await request(server,`/api/collections/${d.id}/export?rows=99`)).text).length,0);
  for (const route of ['/','/style.css','/app.js']) { const r = await request(server,route); assert.equal(r.status,200); assert.ok(r.text.length > 100); }
  assert.equal((await request(server,'/api/collections/missing')).status,404);
  assert.equal((await request(server,'/../../server.js')).status,404);
});
test('collection jobs persist successful results and report partial failures', async t => {
  const {server,root} = setup(t, { collector:async (url,progress = () => {}) => { progress({phase:'discovering',page:1,total:2}); return ['one','two']; }, scraper:async (slugs,origin,progress = () => {}) => { progress({phase:'scraping',completed:2,total:2,failed:1}); return [row]; } });
  const started = await request(server,'/api/jobs',{method:'POST',body:{url:'https://example.com/collection/test'}}); assert.equal(started.status,202);
  await new Promise(resolve => setImmediate(resolve));
  const job = (await request(server,'/api/jobs/' + started.json().id)).json(); assert.equal(job.phase,'complete'); assert.equal(job.failed,1);
  const restored = loadLibrary(root); assert.equal(restored.length,2); assert.equal(restored[0].id,job.datasetId);
  const legacy = await request(server,'/api/scrape?url=' + encodeURIComponent(row.url)); assert.equal(legacy.status,200); assert.equal(parseCsv(legacy.text).length,1);
});
test('invalid input, cross-origin writes and empty scrapes return useful errors', async t => {
  const {server} = setup(t,{collector:async()=>[]});
  assert.equal((await request(server,'/api/jobs',{method:'POST',body:'{bad'})).status,400);
  assert.equal((await request(server,'/api/jobs',{method:'POST',body:{url:row.url},origin:'https://evil.example'})).status,403);
  const started = await request(server,'/api/jobs',{method:'POST',body:{url:'https://example.com/collection/empty'}});
  await new Promise(resolve=>setImmediate(resolve));
  const job = (await request(server,'/api/jobs/' + started.json().id)).json(); assert.equal(job.phase,'error'); assert.match(job.error,/No product data found/);
});
test('a second job is queued rather than rejected while one is running', async t => {
  let release;
  const wait = new Promise(resolve => {release=resolve;});
  const {server} = setup(t,{collector:async()=>wait,scraper:async()=>[row]});
  const first = await request(server,'/api/jobs',{method:'POST',body:{url:'https://example.com/collection/first'}});
  const second = await request(server,'/api/jobs',{method:'POST',body:{url:'https://example.com/collection/second'}});
  assert.equal(first.status,202); assert.equal(second.status,202);
  const queued = (await request(server,'/api/jobs/' + second.json().id)).json(); assert.equal(queued.phase,'queued');
  release(['one']);
  await new Promise(resolve=>setImmediate(resolve));
});
test('scraper discovers unique products and reports completed and failed fetches', async t => {
  const original = global.fetch; t.after(()=>{global.fetch=original;});
  global.fetch = async url => {
    const u = new URL(url);
    if (u.pathname.startsWith('/collection/')) return {ok:true,text:async()=> 'window.APP_DATA = ' + JSON.stringify({reduxData:{collection:{item:{items:[{slug:'one'},{slug:'one'},{slug:'two'}],page:{has_next:false}}}}})};
    if (u.pathname.includes('/two/')) return {ok:false,status:503};
    return {ok:true,text:async()=> 'window.APP_DATA = ' + JSON.stringify({reduxData:{product:{product_details:{name:'One',media:[{url:row.images[0]}]}}}})};
  };
  const slugs = await collectCollectionSlugs('https://example.com/collection/test'); assert.deepEqual(slugs,['one','two']);
  const progress = []; const rows = await scrapeAll(slugs,'https://example.com',p=>progress.push(p));
  assert.equal(rows.length,1); assert.equal(progress.at(-1).completed,2); assert.equal(progress.at(-1).failed,1);
});
