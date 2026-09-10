#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { collectCollectionSlugs, scrapeAll, rowsToCsv, slugFromProductUrl } = require('./scrape');
const { loadLibrary, saveLibrary } = require('./library');
const {validateUrl}=require('./web-fetch');
const {createQueue}=require('./job-queue');
function createApp({ root = __dirname, collector, scraper, engine } = {}) {
  const datasets = loadLibrary(root);
  // Preserve injectable Fynd fixtures while production uses the multi-platform engine.
  if (!engine && (collector || scraper)) engine = async (url, options) => {
    const parsed=validateUrl(url);
    const slugs=parsed.pathname.includes('/product/')?[slugFromProductUrl(url)]:await (collector||collectCollectionSlugs)(url,options.onProgress);
    const rows=await (scraper||scrapeAll)(slugs,parsed.origin,options.onProgress);
    return {rows,platform:'Fynd',warnings:[],issues:[],failed:Math.max(0,slugs.length-rows.length)};
  };
  const queue=createQueue({root,datasets,engine});
  const jobs=queue.jobs;
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const summary = ({ rows, ...d }) => {
    const withImages = rows.filter(r => r.images.length);
    const coverIndex = [...d.id].reduce((n,c) => n + c.charCodeAt(0), 0) % Math.max(1,withImages.length);
    return { ...d, count: rows.length, imageCount: rows.reduce((n, r) => n + r.images.length, 0), cover: withImages[coverIndex]?.images[0] || '' };
  };
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && ['/','/app.js','/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: http: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        res.end(fs.readFileSync(path.join(__dirname, 'public', file))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/collections') return json(res, 200, datasets.map(summary));
      if (req.method === 'GET' && url.pathname.startsWith('/api/collections/')) {
        const [, , , id, action] = url.pathname.split('/'), d = datasets.find(d => d.id === id);
        if (!d) return json(res, 404, { error: 'Collection not found' });
        if (action === 'export') {
          const selected = url.searchParams.get('rows'), indexes = selected === null ? null : new Set(selected.split(',').map(Number));
          const rows = indexes ? d.rows.filter((_, i) => indexes.has(i)) : d.rows;
          const filename = d.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 100) + '.csv';
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` }); res.end('\uFEFF' + rowsToCsv(rows)); return;
        }
        return json(res, 200, d);
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res,200,[...jobs.values()].reverse());
      if (url.pathname.startsWith('/api/jobs/')) {
        const [, , , id, action]=url.pathname.split('/'), job=jobs.get(id);
        if(!job)return json(res,404,{error:'Run not found'});
        if(req.method==='POST' && action==='cancel') {
          if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Requests must come from this app.'});
          return json(res,200,queue.cancel(id));
        }
        if(req.method==='GET' && action==='export') {
          const rows=queue.exportRows(id);
          if(!rows.length)return json(res,422,{error:'No products available to export yet.'});
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="collected-products.csv"'});res.end('\uFEFF'+rowsToCsv(rows));return;
        }
        if(req.method==='GET' && action==='report') {
          const {csvEscape}=require('./scrape');
          const lines=[['Input URL','Status','Platform','Products','Error','Warnings','Page issues'],...job.items.map(it=>[it.url,it.status,it.platform||'',it.count||0,it.error||'',(it.warnings||[]).join('; '),JSON.stringify(it.issues||[])])];
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="collection-report.csv"'});res.end('\uFEFF'+lines.map(r=>r.map(csvEscape).join(',')).join('\n'));return;
        }
        if(req.method==='GET')return json(res,200,job);
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Requests must come from this app.'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>10*1024*1024)return json(res,413,{error:'This batch exceeds 10 MB. Split it into smaller batches.'});}
        let values;
        try{
          values=JSON.parse(body);
          const urls=Array.isArray(values.urls)?values.urls:String(values.urls||values.url||'').split(/\r?\n/);
          if(urls.some(u=>typeof u!=='string'))throw new Error('Each link must be text.');
          const maxPages=Number(values.maxPages||0);
          if(!Number.isSafeInteger(maxPages)||maxPages<0)throw new Error('Page limit must be a non-negative whole number. Use 0 for no limit.');
          return json(res,202,queue.submit(urls,{maxPages,browser:values.browser!==false}));
        }catch(e){return json(res,400,{error:e.message});}
      }
      if (req.method === 'GET' && url.pathname === '/api/scrape') {
        let parsed; try { parsed = validateUrl(url.searchParams.get('url')); } catch (err) { return json(res, 400, { error: err.message }); }
        const result=await (engine||require('./universal-scraper').scrapeStore)(parsed.href,{});
        const rows=result.rows;
        if (!rows.length) return json(res, 422, { error: 'No products found at that URL' });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'X-Filename': 'products.csv', 'Content-Disposition': 'attachment; filename="products.csv"' }); res.end(rowsToCsv(rows)); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) { if (!res.headersSent) json(res, 500, { error: err.message }); else res.end(); }
  });
}
if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT) || 3000;
  // Render (and most hosts) route external traffic to the container's own address, not loopback.
  const host = process.env.RENDER || process.env.HOST ? '0.0.0.0' : '127.0.0.1';
  const app = createApp();
  app.on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Run node server.js with an available port.` : `Unable to start Atelier: ${err.message}`);
    process.exitCode = 1;
  });
  app.listen(port, host, () => console.log(`Atelier is ready at http://${host}:${port}`));
}
module.exports = { createApp, validateUrl };
