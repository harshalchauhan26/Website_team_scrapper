const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function parseCsv(text) {
  const records = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || field === '')) {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) records.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  row.push(field); if (row.some(Boolean)) records.push(row);
  const headers = records.shift() || [];
  return records.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])));
}
function normalize(records) {
  const products = new Map();
  for (const r of records) {
    const url = r.URL || r.Permalink || r['Product URL'] || '', name = r.Name || r['Product Name'] || '';
    if (!name) continue;
    const key = url || r.SKU || name;
    let origin = ''; try { origin = new URL(url).hostname; } catch {}
    const images = [r.MainImage, r['Image URL'], ...(r.Images || '').split(/\s*\|\s*/), ...Object.entries(r).filter(([k]) => /^Image \d+$/.test(k)).map(([, v]) => v)].filter(v => /^https?:\/\//.test(v || ''));
    if (products.has(key)) { products.get(key).images = [...new Set([...products.get(key).images, ...images])]; continue; }
    const standard = /^(Name|Product Name|SKU|ID|UID|Price|Price \(INR\)|MRP|MRP \(INR\)|RegularPrice|Brand|URL|Permalink|Product URL|Description|ShortDescription|Short Description|Images|MainImage|Image URL|Image \d+)$/;
    products.set(key, { name, sku: r.SKU || '', uid: r.UID || r.ID || '', price: r.Price || r['Price (INR)'] || r['MRP (INR)'] || '', mrp: r.MRP || r.RegularPrice || r['MRP (INR)'] || '', brand: r.Brand || origin.replace(/^www\./, ''), url, description: r.Description || '', shortDescription: r.ShortDescription || r['Short Description'] || '', images: [...new Set(images)], attributes: {Currency:r.Currency || (Object.keys(r).some(k=>k.includes('(INR)'))?'INR':''),...Object.fromEntries(Object.entries(r).filter(([k, v]) => !standard.test(k) && v))}, groups: {} });
  }
  return [...products.values()];
}
function loadLibrary(root) {
  const datasets = [];
  for (const name of fs.readdirSync(root).filter(n => n.endsWith('.csv')).sort()) {
    const rows = normalize(parseCsv(fs.readFileSync(path.join(root, name), 'utf8')));
    if (rows.length) datasets.push({ id: 'file-' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 12), name: name.replace(/\.csv$/, '').replace(/[-_]/g, ' '), source: name, sourceType: 'Imported CSV', createdAt: fs.statSync(path.join(root, name)).mtime.toISOString(), rows });
  }
  const saved = path.join(root, '.data', 'collections.json');
  if (fs.existsSync(saved)) {
    const history = JSON.parse(fs.readFileSync(saved, 'utf8'));
    if (!Array.isArray(history)) throw new Error('Saved collections are not a valid list');
    datasets.unshift(...history);
  }
  return datasets;
}
function saveLibrary(root, datasets) {
  const dir = path.join(root, '.data'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'collections.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(datasets.filter(d => d.sourceType !== 'Imported CSV')), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
module.exports = { parseCsv, normalize, loadLibrary, saveLibrary };
