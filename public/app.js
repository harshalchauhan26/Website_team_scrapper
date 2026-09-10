'use strict';
const $ = id => document.getElementById(id);
const paths = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder:'<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  box:'<path d="m12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5M12 13v9M7 5.8l9 5"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  link:'<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  moon:'<path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const textOnly = value => { const doc = new DOMParser().parseFromString(String(value || ''), 'text/html'); return doc.body.textContent || ''; };
const fmt = n => Number(n).toLocaleString('en-IN');
const price = r => r.price === '' || r.price == null ? 'Price unavailable' : Number.isFinite(Number(r.price)) ? (r.attributes?.Currency && r.attributes.Currency !== 'INR' ? esc(r.attributes.Currency) + ' ' : '₹') + fmt(r.price) : esc(r.price);
const date = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const image = (url, alt, cls = '') => safeUrl(url) ? `<img src="${esc(safeUrl(url))}" alt="${esc(alt)}" class="${cls}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="image-fallback">No image available</div>';
const storage = { get(key) { try { return localStorage.getItem('atelier-' + key); } catch { return null; } }, set(key, value) { try { localStorage.setItem('atelier-' + key, value); } catch {} }, remove(key) { try { localStorage.removeItem('atelier-' + key); } catch {} } };
let collections = [], current = null, selected = new Set(), page = 1, view = storage.get('view') || 'grid', toastTimer, opening = 0;
const pageSize = 24;
async function api(url, options) { const res = await fetch(url, options); const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.'); return body; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') { const fallback = document.createElement('div'); fallback.className = 'image-fallback'; fallback.textContent = 'Image unavailable'; e.target.replaceWith(fallback); } }, true);
if (storage.get('theme') === 'dark') document.body.classList.add('dark');
$('theme').onclick = () => { document.body.classList.toggle('dark'); storage.set('theme', document.body.classList.contains('dark') ? 'dark' : 'light'); };
$('guide-button').onclick = () => openDialog('guide-dialog');
$('new-collection').onclick = () => { $('capture-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); $('source-url').focus({ preventScroll: true }); };
$('example-button').onclick = () => { $('source-url').value = 'https://isabydollywahal.com/product/zaria-lehenga-96412447'; $('source-url').focus(); };
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
  const activity = b.dataset.nav === 'activity';
  document.querySelectorAll('[data-nav]').forEach(n => n.classList.toggle('active', n === b));
  $('library-section').hidden = activity; $('activity-section').hidden = !activity;
  $('page-title').innerHTML = activity ? 'Collection activity<span>.</span>' : 'Collection library<span>.</span>';
  $('breadcrumb-current').textContent = activity ? 'Collection activity' : 'Collection library';
  $('page-subtitle').textContent = activity ? 'Every saved collection, with its source and collection date.' : 'Find the details. Keep the inspiration. Make it yours.';
});
async function loadCollections() {
  collections = await api('/api/collections');
  $('stat-collections').textContent = fmt(collections.length); $('nav-count').textContent = collections.length;
  $('stat-products').textContent = fmt(collections.reduce((s, c) => s + c.count, 0));
  $('stat-images').textContent = fmt(collections.reduce((s, c) => s + c.imageCount, 0));
  renderCollections();
  const cover = collections.find(c => c.cover)?.cover;
  if (cover && !$('capture-photo').querySelector('img')) $('capture-photo').insertAdjacentHTML('afterbegin', image(cover, 'Product from your imported collection'));
  $('activity-list').innerHTML = collections.length ? [...collections].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(c => `<div class="activity-row"><span>${icon(c.sourceType === 'Imported CSV' ? 'folder' : 'check')}</span><div><strong>${esc(c.name)}</strong><p>${esc(c.sourceType)} · ${fmt(c.count)} products · ${esc(new Date(c.createdAt).toLocaleString())}${c.failed ? ' · ' + c.failed + ' products skipped' : ''}</p></div><button class="button secondary" data-open="${esc(c.id)}">View collection ↗</button></div>`).join('') : '<div class="empty-state">Your collection history will appear here.</div>';
}
function renderCollections() {
  const query = $('collection-search').value.trim().toLowerCase();
  const list = collections.filter(c => (c.name + ' ' + c.source).toLowerCase().includes(query));
  $('collection-count').textContent = collections.length;
  $('collection-grid').innerHTML = list.length ? list.map(c => `<button class="collection-card" data-open="${esc(c.id)}" aria-label="Open ${esc(c.name)}"><div class="collection-cover">${image(c.cover, c.name)}<span class="cover-label"><span class="local-dot"></span>${esc(c.sourceType)}</span><span class="cover-open">↗</span></div><div class="collection-content"><h3>${esc(c.name)}</h3><p class="source">${esc(c.source)}</p><div class="collection-meta"><span>${icon('box')}${fmt(c.count)} products</span><span>${icon('image')}${fmt(c.imageCount)} images</span><time datetime="${esc(c.createdAt)}">${date(c.createdAt)}</time></div></div></button>`).join('') : `<div class="empty-state">${query ? 'No collections match your search. Try a different name.' : 'Your library is ready for its first collection. Paste a storefront link above to get started.'}</div>`;
}
$('collection-search').oninput = renderCollections;
document.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openCollection(b.dataset.open); });
async function openCollection(id) {
  const token = ++opening;
  try {
    const data = await api('/api/collections/' + encodeURIComponent(id));
    if (token !== opening) return;
    current = data; selected = new Set(); page = 1; $('product-search').value = ''; $('product-sort').value = 'original';
    $('detail-title').textContent = current.name; $('detail-source').textContent = current.sourceType;
    $('detail-summary').textContent = `${current.rows.length} products · ${current.source}${current.failed ? ' · ' + current.failed + ' products could not be retrieved' : ''}`;
    renderProducts(); openDialog('collection-dialog');
  } catch (err) { toast(err.message); }
}
function filteredProducts() {
  if (!current) return [];
  const q = $('product-search').value.toLowerCase().trim();
  const rows = current.rows.map((r,i) => ({...r, index:i})).filter(r => (r.name + ' ' + r.brand + ' ' + r.sku).toLowerCase().includes(q));
  const sort = $('product-sort').value;
  if (sort === 'name') rows.sort((a,b) => a.name.localeCompare(b.name));
  if (sort.startsWith('price')) rows.sort((a,b) => { const av = a.price === '' ? NaN : Number(a.price), bv = b.price === '' ? NaN : Number(b.price); if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0; if (!Number.isFinite(bv)) return -1; return sort === 'price-low' ? av-bv : bv-av; });
  return rows;
}
function renderProducts() {
  const rows = filteredProducts(), pages = Math.max(1, Math.ceil(rows.length / pageSize)); page = Math.min(page, pages);
  const visible = rows.slice((page-1)*pageSize, page*pageSize);
  const checkbox = r => `<input type="checkbox" data-select="${r.index}" aria-label="Select ${esc(r.name)}" ${selected.has(r.index) ? 'checked' : ''}>`;
  $('view-grid').classList.toggle('active', view === 'grid'); $('view-table').classList.toggle('active', view === 'table');
  $('view-grid').setAttribute('aria-pressed', String(view === 'grid')); $('view-table').setAttribute('aria-pressed', String(view === 'table'));
  if (!rows.length) $('product-results').innerHTML = '<div class="empty-state">No products match your search. Try a name, brand or SKU.</div>';
  else if (view === 'grid') $('product-results').innerHTML = visible.map(r => `<article class="product-card"><label>${checkbox(r)}</label><button data-product="${r.index}" aria-label="View ${esc(r.name)}"><div class="product-image">${image(r.images[0], r.name)}</div><div class="product-info"><h3>${esc(r.name)}</h3><p>${esc(r.sku || r.brand)}</p><strong>${price(r)}<small>${r.images.length} images</small></strong></div></button></article>`).join('');
  else $('product-results').innerHTML = `<div class="table-wrapper"><table><thead><tr><th><span class="sr-only">Select</span></th><th>Product</th><th>SKU</th><th>Price</th><th>Brand</th><th>Images</th></tr></thead><tbody>${visible.map(r => `<tr><td>${checkbox(r)}</td><td><button class="table-product" data-product="${r.index}">${image(r.images[0], '')}${esc(r.name)}</button></td><td>${esc(r.sku || '—')}</td><td>${price(r)}</td><td>${esc(r.brand)}</td><td>${r.images.length}</td></tr>`).join('')}</tbody></table></div>`;
  $('page-count').textContent = `Page ${page} of ${pages}`; $('previous-page').disabled = page <= 1; $('next-page').disabled = page >= pages;
  $('results-count').textContent = `${fmt(rows.length)} results`; updateSelection();
}
function updateSelection() {
  const visible = filteredProducts().slice((page-1)*pageSize, page*pageSize);
  const count = visible.filter(r => selected.has(r.index)).length;
  $('select-all').checked = visible.length > 0 && count === visible.length; $('select-all').indeterminate = count > 0 && count < visible.length;
  $('select-all').disabled = visible.length === 0;
  $('selection-count').textContent = `${selected.size} selected`;
  $('export-button').innerHTML = icon('download') + (selected.size ? `Export ${selected.size} selected` : 'Export all CSV');
}
$('product-results').addEventListener('change', e => { if (e.target.matches('[data-select]')) { const i = Number(e.target.dataset.select); e.target.checked ? selected.add(i) : selected.delete(i); updateSelection(); } });
$('product-results').addEventListener('click', e => { const b = e.target.closest('[data-product]'); if (b) showProduct(Number(b.dataset.product)); });
$('select-all').onchange = e => { filteredProducts().slice((page-1)*pageSize, page*pageSize).forEach(r => e.target.checked ? selected.add(r.index) : selected.delete(r.index)); renderProducts(); };
$('product-search').oninput = () => { page = 1; renderProducts(); }; $('product-sort').onchange = () => { page = 1; renderProducts(); };
['grid','table'].forEach(mode => $('view-' + mode).onclick = () => { view = mode; storage.set('view', view); renderProducts(); });
$('previous-page').onclick = () => { page--; renderProducts(); }; $('next-page').onclick = () => { page++; renderProducts(); };
$('export-button').onclick = async () => {
  const button = $('export-button'); button.disabled = true;
  try {
    const res = await fetch(`/api/collections/${encodeURIComponent(current.id)}/export` + (selected.size ? '?rows=' + [...selected].join(',') : ''));
    if (!res.ok) throw new Error('Export failed. Please try again.');
    const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = current.name.replace(/[^a-z0-9-]/gi,'-') + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('selection-count').textContent = 'CSV download started';
  } catch (err) { $('selection-count').textContent = err.message; } finally { button.disabled = false; }
};
function showProduct(index) {
  const r = current.rows[index];
  const details = Object.entries({ SKU: r.sku, Brand: r.brand, ...r.attributes, ...r.groups }).filter(([,v]) => v);
  $('product-detail').innerHTML = `<div class="product-detail-layout"><div class="gallery"><div id="gallery-main">${image(r.images[0], r.name, 'gallery-main')}</div><div class="thumbnails">${r.images.map((url,i) => `<button data-image="${i}" class="${i === 0 ? 'active' : ''}" aria-label="View image ${i+1}">${image(url, 'Image ' + (i+1))}</button>`).join('')}</div></div><div class="product-detail-copy"><p class="eyebrow">${esc(r.brand || 'PRODUCT DETAILS')}</p><h2>${esc(r.name)}</h2><div class="detail-price">${price(r)}${Number(r.mrp) > Number(r.price) && r.price !== '' ? '<del>' + esc(r.attributes?.Currency || '') + ' ' + fmt(r.mrp) + '</del>' : ''}</div>${safeUrl(r.url) ? `<a class="source-link" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">View original product ↗</a>` : ''}<p class="product-description">${esc(textOnly(r.description || r.shortDescription || 'No description was provided in the source.'))}</p><dl>${details.map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(textOnly(v))}</dd>`).join('')}</dl></div></div>`;
  $('product-detail').querySelectorAll('[data-image]').forEach(b => b.onclick = () => { $('gallery-main').innerHTML = image(r.images[Number(b.dataset.image)], r.name, 'gallery-main'); $('product-detail').querySelectorAll('[data-image]').forEach(t => t.classList.toggle('active', t === b)); });
  openDialog('product-dialog');
}
let jobsTimer, jobSignature='', jobsFetching=false;
const finished = phase => ['complete','error','cancelled'].includes(phase);
function renderJobs(jobs) {
  $('queue-panel').hidden=!jobs.length;
  $('queue-count').textContent=jobs.filter(j=>!finished(j.phase)).length+' active';
  $('queue-list').innerHTML=jobs.map(job=>{
    const errors=job.items.filter(it=>it.status==='error').length;
    const partial=job.items.some(it=>(it.warnings||[]).length);
    return `<article class="queue-job"><div class="queue-job-head"><div><strong>${job.items.length} link${job.items.length===1?'':'s'} ? ${esc(job.phase)}</strong><p>${fmt(job.count||0)} products saved ? ${job.linksCompleted||0}/${job.items.length} links processed${errors?' ? '+errors+' failed':''}${partial?' ? Review collection notes':''}</p></div><div class="queue-actions">${job.count?'<a class="button primary" href="/api/jobs/'+esc(job.id)+'/export" download>Download CSV</a>':''}<a class="button secondary" href="/api/jobs/${esc(job.id)}/report" download>Run report</a>${!finished(job.phase)?'<button class="button secondary" data-cancel="'+esc(job.id)+'">Cancel</button>':''}</div></div>${!finished(job.phase)?'<p class="queue-progress">'+esc(job.message||'Waiting for a queue slot?')+' ? '+(job.pages||0)+' pages read ? '+(job.completed||0)+' products found on this link</p>':''}${job.error?'<p class="queue-error">'+esc(job.error)+'</p>':''}<details><summary>View links & collection notes</summary><div class="queue-links">${job.items.map(it=>'<div><span class="status-badge">'+esc(it.status)+'</span><span class="queue-url">'+esc(it.url)+'</span><span>'+esc(it.platform||'')+'</span>'+(it.datasetId?'<button class="text-button" data-open="'+esc(it.datasetId)+'">Open '+(it.count||0)+' products ?</button>':'')+(it.error?'<p class="queue-error">'+esc(it.error)+'</p>':'')+(it.warnings||[]).map(w=>'<p class="queue-note">'+esc(w)+'</p>').join('')+'</div>').join('')}</div></details></article>`;
  }).join('');
}
async function refreshJobs() {
  clearTimeout(jobsTimer); if(jobsFetching)return; jobsFetching=true;
  try {
    const jobs=await api('/api/jobs');
    const open=[...$('queue-list').querySelectorAll('details')].map(d=>d.open);
    renderJobs(jobs);$('queue-list').querySelectorAll('details').forEach((d,i)=>{d.open=!!open[i];});
    const signature=jobs.map(j=>j.id+':'+j.count+':'+j.phase).join('|');
    if(signature!==jobSignature){jobSignature=signature;await loadCollections();}
  } catch(err){$('job-status').hidden=false;$('job-status').textContent='Unable to refresh queue: '+err.message;}
  finally {jobsFetching=false;jobsTimer=setTimeout(refreshJobs,2000);}
}
$('refresh-jobs').onclick=refreshJobs;
$('queue-list').addEventListener('click',async e=>{const b=e.target.closest('[data-cancel]');if(!b)return;b.disabled=true;try{await api('/api/jobs/'+b.dataset.cancel+'/cancel',{method:'POST'});await refreshJobs();}catch(err){toast(err.message);b.disabled=false;}});
$('links-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){toast('Split this file into batches smaller than 10 MB.');return;}$('source-url').value=await file.text();e.target.value='';};
$('scrape-form').onsubmit=async e=>{
  e.preventDefault();const button=$('collect-button');button.disabled=true;
  try {
    const urls=$('source-url').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const job=await api('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls,maxPages:Number($('page-limit').value),browser:$('browser-fallback').checked})});
    $('job-status').hidden=false;$('job-status').classList.remove('error');$('job-status').textContent=job.items.length+' link(s) added. You can add another batch while this one runs.';
    $('source-url').value='';await refreshJobs();
  }catch(err){$('job-status').hidden=false;$('job-status').classList.add('error');$('job-status').textContent=err.message;}
  finally{button.disabled=false;}
};
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); if ($('collection-dialog').open && !$('product-dialog').open) $('product-search').focus(); else if (!document.querySelector('dialog[open]')) $('collection-search').focus(); } });
loadCollections().catch(err => { $('collection-grid').innerHTML = `<div class="empty-state">Could not load the library: ${esc(err.message)}<br><button class="button secondary" id="retry-library">Try again</button></div>`; $('retry-library').onclick = () => location.reload(); });
refreshJobs();
