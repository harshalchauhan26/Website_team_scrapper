const cheerio = require('cheerio');
const { createFetcher, validateUrl } = require('./web-fetch');
const { extractAppData, buildRow } = require('./scrape');
const { createRenderer } = require('./render-page');

const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
const plain = v => cheerio.load(String(v ?? ''),null,false).text().trim();
const absolute = (value,base) => { try { const u=new URL(value,base); if(!['http:','https:'].includes(u.protocol)) return ''; u.hash=''; return u.href; } catch{return '';} };
const canonical = value => { const u=new URL(value); u.hash=''; for(const k of [...u.searchParams.keys()]) if(/^(utm_|fbclid|gclid)/.test(k)) u.searchParams.delete(k); u.pathname=u.pathname.replace(/\/$/,'') || '/'; return u.href; };
const money = (value,scale=1) => value===null || value===undefined || value==='' ? '' : Number.isFinite(Number(value)) ? Number(value)/scale : plain(value);
function productRow(data,method) {
  return {name:plain(data.name),sku:String(data.sku || ''),uid:data.uid ?? '',price:data.price ?? '',mrp:data.mrp ?? '',brand:plain(data.brand),description:plain(data.description),shortDescription:plain(data.shortDescription),url:data.url,images:[...new Set(array(data.images).map(v=>absolute(typeof v==='string'?v:v?.url||v?.src,data.url)).filter(Boolean))],attributes:{Currency:data.currency || '',...data.attributes,'Extraction method':method,'Collected at':new Date().toISOString()},groups:data.groups||{}};
}
function shopifyRow(p,base,currency,minor=false) {
  const variants=p.variants||[], v=variants.find(v=>v.available) || variants[0] || {};
  const scale=minor?100:1;
  return productRow({name:p.title,sku:v.sku,uid:p.id,price:money(v.price ?? p.price,scale),mrp:money(v.compare_at_price ?? p.compare_at_price,scale),brand:p.vendor,description:p.body_html||p.description,url:absolute(p.url || `products/${p.handle}`,base),images:p.images,currency,attributes:{'Product type':p.product_type||p.type||'','Tags':array(p.tags).join('; '),'Options':array(p.options).map(o=>typeof o==='string'?o:`${o.name}: ${array(o.values).join(', ')}`).join('; '),'Variants':JSON.stringify(variants.map(v=>({sku:v.sku,title:v.title,price:money(v.price,scale),available:v.available}))),Availability:p.available===undefined?'':p.available?'In stock':'Out of stock'}},'Shopify public product data');
}
function wooRow(p) {
  const pricing=p.prices||{}, scale=10**Number(pricing.currency_minor_unit ?? 2);
  return productRow({name:p.name,sku:p.sku,uid:p.id,price:money(pricing.price,scale),mrp:money(pricing.regular_price,scale),brand:array(p.brands).map(b=>b.name).join('; '),description:p.description,shortDescription:p.short_description,url:p.permalink,images:array(p.images).map(i=>i.src),currency:pricing.currency_code,attributes:{Categories:array(p.categories).map(c=>c.name).join('; '),Availability:p.is_in_stock?'In stock':'Out of stock',...Object.fromEntries(array(p.attributes).map(a=>[a.name,array(a.terms).map(t=>t.name).join('; ')]))}},'WooCommerce Store API');
}
function extractProducts(html,url) {
  const $=cheerio.load(html), rows=[];
  const meta = key => $(`meta[property="${key}"],meta[name="${key}"]`).first().attr('content') || '';
  const visited=new Set();
  function walk(node) {
    if(!node || typeof node!=='object') return;
    if(Array.isArray(node)) {node.forEach(walk);return;}
    if(array(node['@type']).some(t=>/(^|[/#])(Product|ProductGroup)$/.test(t))) {
      const offer=array(node.offers)[0]||{}, actual=array(offer.offers)[0]||offer;
      const candidate=absolute(node.url || actual.url || node['@id'] || url,url);
      const key=candidate+'|'+node.name;
      if(node.name && !visited.has(key)) {
        visited.add(key);
        rows.push(productRow({name:node.name,sku:node.sku||node.mpn,uid:node.productID,price:money(actual.price ?? actual.lowPrice ?? actual.priceSpecification?.price),mrp:'',brand:typeof node.brand==='string'?node.brand:node.brand?.name,description:node.description,url:candidate,images:node.image,currency:actual.priceCurrency||actual.priceSpecification?.priceCurrency,attributes:{Availability:actual.availability||'',Category:node.category||'',Rating:node.aggregateRating?.ratingValue||'',Reviews:node.aggregateRating?.reviewCount||'',...Object.fromEntries(array(node.additionalProperty).filter(p=>p?.name).map(p=>[p.name,plain(p.value)]))}},'Product structured data'));
      }
    }
    for(const v of Object.values(node)) if(v && typeof v==='object') walk(v);
  }
  $('script[type="application/ld+json"]').each((_,el)=>{try{walk(JSON.parse($(el).text().replace(/^\s*<!--|-->\s*$/g,'')));}catch{}});
  $('[itemtype$="/Product"],[itemtype$="#Product"]').each((_,el)=>{
    const block=$(el), prop=k=>{const e=block.find(`[itemprop="${k}"]`).first();return e.attr('content')||e.attr('href')||e.attr('src')||e.text();};
    const name=prop('name');if(!name)return;
    rows.push(productRow({name,sku:prop('sku'),price:money(prop('price')),currency:prop('priceCurrency'),brand:prop('brand'),description:prop('description'),url:absolute(prop('url')||url,url),images:prop('image')},'Product microdata'));
  });
  const h1=$('h1').first().text().trim();
  // Only treat the page itself as a product when product-specific evidence exists.
  if(!rows.length && (meta('og:type').includes('product') || meta('product:price:amount') || $('form.cart,.product_page,.product-detail,[data-product-id] h1').length)) {
    const amount=meta('product:price:amount')||meta('og:price:amount')||$('[itemprop="price"]').first().attr('content')||$('.summary .price,.product_main .price_color').first().text().replace(/[^\d.,]/g,'').replace(/,/g,'');
    const images=$('.woocommerce-product-gallery img,.product-gallery img,#product_gallery img').map((_,el)=>$(el).attr('data-large_image')||$(el).attr('data-src')||$(el).attr('src')).get();
    if(h1||meta('og:title')) rows.push(productRow({name:h1||meta('og:title'),sku:$('.sku').first().text(),price:money(amount),currency:meta('product:price:currency')||meta('og:price:currency'),description:$('.woocommerce-product-details__short-description,#product_description + p,.product-description').first().text()||meta('description'),url,images:images.length?images:[meta('og:image')]},'Product page HTML'));
  }
  return rows;
}
function discoverLinks(html,base) {
  const $=cheerio.load(html), products=new Set(), next=new Set(), sections=new Set(), origin=new URL(base).origin;
  function add(set,href) {const url=absolute(href,base);if(!url)return;const u=new URL(url);if(u.origin!==origin || /\.(jpg|png|pdf|css|js|zip|webp)(\?|$)/i.test(url) || /\/(cart|checkout|account|login|wishlist)(\/|$)/i.test(u.pathname) || u.searchParams.has('add-to-cart'))return;set.add(canonical(url));}
  $('a[href]').each((_,el)=>{
    const a=$(el), href=a.attr('href'), text=a.text().trim(), rel=a.attr('rel')||'';
    if(/\/(products?|p)\/[^/?#]+/i.test(href) && !/\/products?\/(page|category|tag)\//i.test(href)) add(products,href);
    if(a.closest('.product-card,.product-item,li.product,article.product_pod,[data-product-id]').length && (a.find('img').length || a.closest('h2,h3').length || a.is('.woocommerce-LoopProduct-link'))) add(products,href);
    if(/next/i.test(rel) || /^(next|next page|older|›|»|→)(\s.*)?$/i.test(text) || a.is('.next,.pagination-next')) add(next,href);
    if(/\/(collections?|product-category|shop|catalogue|catalog)(\/|\?|$)/i.test(href) && !/\/(products?|p)\//i.test(href)) add(sections,href);
  });
  $('link[rel="next"]').each((_,e)=>add(next,$(e).attr('href')));
  return {products:[...products],next:[...next],sections:[...sections]};
}
async function scrapeStore(input,{signal,onProgress=()=>{},maxPages=0,browser=true,request:injected,rendererFactory=createRenderer}={}) {
  const initial=validateUrl(input), request=injected||createFetcher({signal});
  const rows=new Map(), warnings=[], issues=[];let pages=0,failed=0,platform='Detecting',renderer;
  const warn=message=>{if(!warnings.includes(message))warnings.push(message);};
  const update=(extra={})=>onProgress({phase:'scraping',platform,pages,completed:rows.size,total:0,failed,...extra});
  const add=row=>{
    if(!row?.name || !row.url)return;
    const key=canonical(row.url),old=rows.get(key);
    if(old) { row={...old,...row,images:[...new Set([...old.images,...row.images])],attributes:{...old.attributes,...row.attributes}};for(const k of ['price','mrp','description','sku','brand']) if(row[k]===''&&old[k]!=='')row[k]=old[k]; }
    rows.set(key,row);update();
  };
  async function get(url) {signal?.throwIfAborted();if(maxPages>0 && pages>=maxPages){const e=new Error(`Stopped at the configured ${maxPages}-page limit; results may be incomplete.`);e.limit=true;throw e;}pages++;update({message:'Reading '+url});return request(url);}
  async function probe(url) {try{return await get(url);}catch(e){if(signal?.aborted||e.limit)throw e;return null;}}
  async function render(url) {
    if(!browser)return null;
    signal?.throwIfAborted();
    if(maxPages>0&&pages>=maxPages){const e=new Error(`Stopped at the configured ${maxPages}-page limit; results may be incomplete.`);e.limit=true;throw e;}
    try{pages++;update({message:'Rendering '+url});renderer ||= await rendererFactory(signal);const page=await renderer.render(url);if(page.limitReached)warn('Browser scrolling reached 20 rounds on a page. More products may remain.');return page;}
    catch(e){if(signal?.aborted)throw e;warn('Browser fallback: '+e.message);return null;}
  }
  const fail=(url,e)=>{failed++;issues.push({url,error:e.message});update();};
  async function shopify(page) {
    platform='Shopify';update();
    const url=new URL(page.url),match=url.pathname.match(/^(.*?)\/products\/([^/]+)/),collection=url.pathname.match(/^(.*?)\/collections\/([^/]+)/);
    const prefix=match?.[1]?.replace(/\/collections\/[^/]+$/,'') ?? collection?.[1] ?? (url.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i)?.[0]?.replace(/\/$/,'')||'');
    const base=url.origin+prefix+'/';
    let currency=page.text.match(/Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([^"']+)/)?.[1]||'';
    try {currency=(await probe(base+'cart.js'))?.json()?.currency||currency;}catch{}
    if(match) {
      let p;const handle=match[2].replace(/\.(json|js)$/,'');
      try{p=(await probe(base+'products/'+handle+'.json'))?.json()?.product;}catch{}
      if(p?.title){add(shopifyRow(p,base,currency));return true;}
      try{p=(await probe(base+'products/'+handle+'.js'))?.json();}catch{}
      if(p?.title){add(shopifyRow(p,base,currency,true));return true;}return false;
    }
    // Do not turn a search/category/filter link into an unfiltered full catalog.
    const allowed=['sort_by','page','limit'];
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))return false;
    if(!collection && !['/','/products','/products/','/products.json',prefix+'/',prefix].includes(url.pathname))return false;
    const endpoint=collection?base+'collections/'+collection[2]+'/products.json':base+'products.json';
    const seen=new Set();let pageNo=1;
    while(true) {
      const target=new URL(endpoint);target.searchParams.set('limit','250');target.searchParams.set('page',String(pageNo));
      const response=await probe(target.href);let products;try{products=response?.json()?.products;}catch{}
      if(!Array.isArray(products)){if(pageNo>1)warn('Shopify pagination became unavailable; collected results are partial.');return rows.size>0;}
      if(!products.length)return true;
      let added=0;for(const p of products){if(seen.has(p.id||p.handle))continue;seen.add(p.id||p.handle);add(shopifyRow(p,base,currency));added++;}
      if(!added){warn('Shopify repeated a results page. Pagination was stopped to prevent a loop.');return true;}
      pageNo++;
    }
  }
  async function woo(page) {
    platform='WooCommerce';update();const url=new URL(page.url),$=cheerio.load(page.text);
    const rest=$('link[rel="https://api.w.org/"]').attr('href');
    const api=absolute(rest||'/wp-json/',page.url).replace(/\/?$/,'/')+'wc/store/v1/';
    const direct=url.pathname.match(/\/product\/([^/]+)/),category=url.pathname.match(/\/product-category\/(.+?)\/?$/);
    const params=new URLSearchParams({per_page:'100'});
    if(direct)params.set('slug',decodeURIComponent(direct[1]));
    else if(category) {
      const slug=decodeURIComponent(category[1].split('/').pop());let categories;
      try{categories=(await probe(api+'products/categories?slug='+encodeURIComponent(slug)))?.json();}catch{}
      const found=array(categories).find(c=>c.slug===slug);if(!found)return false;params.set('category',String(found.id));
    } else if(!/^\/(shop|products?)?\/?$/.test(url.pathname))return false;
    if([...url.searchParams.keys()].some(k=>!['page','orderby'].includes(k)))return false;
    let pageNo=1;const seen=new Set();
    while(true) {
      params.set('page',String(pageNo));const response=await probe(api+'products?'+params);let products;
      try{products=response?.json();}catch{}
      if(!Array.isArray(products)){if(pageNo>1)warn('WooCommerce pagination became unavailable; collected results are partial.');return rows.size>0;}
      if(!products.length)return true;
      let added=0;for(const p of products){if(!p.permalink||seen.has(p.id))continue;seen.add(p.id);add(wooRow(p));added++;}
      if(!added){warn('WooCommerce repeated a results page. Pagination was stopped to prevent a loop.');return true;}
      const total=Number(response.headers?.get('x-wp-totalpages'));if(direct || (total && pageNo>=total))return true;
      pageNo++;
    }
  }
  async function fynd(page) {
    let app;try{app=extractAppData(page.text);}catch{return false;}
    if(!app?.reduxData)return false;platform='Fynd';update();
    const details=app.reduxData.product?.product_details;
    if(details){add({...buildRow(details,page.url),attributes:{...buildRow(details,page.url).attributes,'Extraction method':'Fynd embedded state'}});return true;}
    if(!app.reduxData.collection?.item)return false;
    const seen=new Set();let pageNo=1,current=page;
    while(true){
      const data=extractAppData(current.text)?.reduxData?.collection?.item;if(!data)throw new Error('Fynd pagination stopped returning collection data.');
      let added=0;for(const item of data.items||[]){if(!item.slug||seen.has(item.slug))continue;seen.add(item.slug);added++;
        const target=new URL('/product/'+item.slug+'/',page.url).href;
        try{const p=await get(target),d=extractAppData(p.text)?.reduxData?.product?.product_details;if(!d)throw new Error('No product details');const row=buildRow(d,p.url);row.attributes['Extraction method']='Fynd embedded state';add(row);}catch(e){if(signal?.aborted||e.limit)throw e;fail(target,e);}
      }
      if(!data.page?.has_next)return true;if(!added){warn('Fynd repeated a results page; pagination stopped.');return true;}
      const next=new URL(page.url);next.searchParams.set('page_no',String(++pageNo));current=await get(next.href);
    }
  }
  async function generic(first) {
    if(platform==='Detecting')platform='Custom / structured data';update();
    const root=new URL(first.url),wholeStore=root.pathname==='/' && !root.search;
    const firstRows=extractProducts(first.text,first.url);
    const $=cheerio.load(first.text),title=plain($('h1').first().text());
    const isDetail=/\/(products?|p)\/[^/]+/.test(root.pathname) || firstRows.some(r=>canonical(r.url)===canonical(root.href)&&plain(r.name).toLowerCase()===title.toLowerCase());
    const queue=[{url:first.url,kind:isDetail?'product':'listing',page:first}],seen=new Set(),scheduled=new Set([canonical(first.url)]);
    const schedule=(url,kind)=>{if(new URL(url).origin!==root.origin)return;const key=canonical(url);if(!scheduled.has(key)){scheduled.add(key);queue.push({url,kind});}};
    if(wholeStore){
      const maps=[root.origin+'/sitemap.xml'],mapSeen=new Set();
      const robots=await probe(root.origin+'/robots.txt');
      for(const match of robots?.text.matchAll(/^sitemap:\s*(\S+)/gim)||[])if(absolute(match[1],root.href))maps.push(absolute(match[1],root.href));
      while(maps.length){const map=maps.shift();if(mapSeen.has(map)||new URL(map).origin!==root.origin)continue;mapSeen.add(map);const result=await probe(map);if(!result)continue;
        const xml=cheerio.load(result.text,{xmlMode:true});
        xml('sitemap > loc').each((_,el)=>{const loc=absolute(xml(el).text(),map);if(loc&&!/(post|blog|news|image|video)[_-]?sitemap|sitemap[_-](post|blog|news|image|video)/i.test(loc))maps.push(loc);});
        xml('url > loc').each((_,el)=>{const loc=absolute(xml(el).text(),map);if(loc&&(/product/i.test(map)||/\/(products?|p)\//.test(loc)))schedule(loc,'product');});
      }
    }
    let cursor=0;
    while(cursor<queue.length){
      const item=queue[cursor++],key=canonical(item.url);if(seen.has(key))continue;seen.add(key);
      try {
        let page=item.page||await get(item.url),found=extractProducts(page.text,page.url),links=discoverLinks(page.text,page.url);
        const jsPage=/__NEXT_DATA__|__NUXT__|id=["'](root|app)["']|type=["']module["']/.test(page.text);
        if((!found.length && (item.kind==='product'||!links.products.length)) || (item.kind==='listing' && (jsPage||/load more|infinite.scroll/i.test(page.text)))) {
          const rendered=await render(page.url);if(rendered){page=rendered;found=extractProducts(page.text,page.url);links=discoverLinks(page.text,page.url);}
        }
        if(item.kind==='product') {
          const matches=found.filter(r=>canonical(r.url)===canonical(page.url));
          const accepted=matches.length?matches:(found.length===1?found:[]);
          if(!accepted.length)throw new Error('No recognizable product data on this page.');
          accepted.forEach(add);continue;
        }
        found.forEach(r=>{add(r);schedule(r.url,'product');});
        links.products.forEach(u=>schedule(u,'product'));links.next.forEach(u=>schedule(u,'listing'));
        if(wholeStore)links.sections.forEach(u=>schedule(u,'listing'));
      } catch(e){if(signal?.aborted||e.limit)throw e;fail(item.url,e);}
    }
    warn('Custom-page discovery is best effort. Unlinked products, hidden variants or unsupported layouts may not be included.');
  }
  try {
    let first;
    try{first=await get(initial.href);}catch(e){if(signal?.aborted||e.limit)throw e;first=await render(initial.href);if(!first)throw e;}
    if(/Shopify\.|cdn\.shopify\.com|shopify-section/i.test(first.text) || /\/products[^/]*\.json$/.test(new URL(first.url).pathname)) {
      if(await shopify(first))return {rows:[...rows.values()],platform,warnings,issues,failed,pages};
      warn('Shopify public endpoint unavailable or link has filters; using page discovery.');
    }
    if(/woocommerce|wc-block|wc\/store/i.test(first.text)) {
      if(await woo(first))return {rows:[...rows.values()],platform,warnings,issues,failed,pages};
      warn('WooCommerce API unavailable or link needs page-specific extraction; using page discovery.');
    }
    if(!await fynd(first))await generic(first);
  } catch(e) {
    if(signal?.aborted)warn('Cancelled. Only products collected before cancellation are included.');
    else if(rows.size||e.limit){warn(e.message);if(!e.limit)fail(initial.href,e);}
    else throw e;
  } finally {if(renderer)await renderer.close();}
  if(failed)warn(`${failed} page(s) could not be fully extracted. See the run report.`);
  return {rows:[...rows.values()],platform,warnings,issues,failed,pages,cancelled:!!signal?.aborted};
}
module.exports={scrapeStore,extractProducts,discoverLinks,shopifyRow,wooRow,canonical};
