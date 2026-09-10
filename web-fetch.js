const dns = require('node:dns').promises;
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

function validateUrl(value) {
  let url; try { url = new URL(String(value).trim()); } catch { throw new Error('Enter a full public website URL starting with https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs without credentials are supported.');
  if (url.port && !['80','443'].includes(url.port)) throw new Error('Use a public storefront on a standard web port.');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || net.isIP(host) || host.includes(':')) throw new Error('Use a public storefront domain, not a local or IP address.');
  url.hash = ''; return url;
}
function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a,b] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0)) || (a===198 && (b===18 || b===19)));
  }
  // Only globally routable unicast IPv6, excluding IPv4-mapped and local ranges.
  return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
async function assertPublic(value) {
  const url = validateUrl(value);
  const records = await dns.lookup(url.hostname, { all:true });
  if (!records.length || records.some(r=>!isPublicAddress(r.address))) throw new Error('This URL resolves to a private or unsupported network address.');
  return url;
}
function createFetcher({ signal, delayMs = 200 } = {}) {
  let last = 0;
  return async function request(input) {
    let url = String(input);
    for (let redirect=0; redirect<8; redirect++) {
      signal?.throwIfAborted(); await assertPublic(url);
      let response;
      for (let attempt=0; attempt<3; attempt++) {
        const wait = Math.max(0,last + delayMs - Date.now());
        if (wait) await delay(wait,undefined,{signal}); last=Date.now();
        const timeout = AbortSignal.timeout(30000);
        const combined = signal ? AbortSignal.any([signal,timeout]) : timeout;
        try {
          response = await fetch(url,{redirect:'manual',signal:combined,headers:{'User-Agent':'Mozilla/5.0 (compatible; AtelierProductResearch/1.0)','Accept':'text/html,application/json,application/xml;q=0.9,*/*;q=0.8'}});
          if ([429,500,502,503,504].includes(response.status) && attempt<2) {
            const retry = response.headers.get('retry-after');
            const waitMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry)*1000 : new Date(retry).getTime()-Date.now()) : (attempt+1)*1500;
            await response.body?.cancel(); await delay(Math.min(30000,Math.max(500,waitMs || 1500)),undefined,{signal}); continue;
          }
          break;
        } catch (err) { if (signal?.aborted || attempt===2) throw err; await delay(1000*(attempt+1),undefined,{signal}); }
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('Redirect did not provide a destination.');
        url = new URL(location,url).href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); const err = new Error(`HTTP ${response.status} at ${url}${[401,403,429].includes(response.status) ? ' — access blocked or rate limited' : ''}`); err.status=response.status; throw err; }
      let text='', bytes=0;
      const decoder = new TextDecoder();
      for await(const chunk of response.body) {
        bytes+=chunk.byteLength;
        if(bytes>30*1024*1024) throw new Error('Response exceeded the 30 MB per-page safety limit.');
        text+=decoder.decode(chunk,{stream:true});
      }
      text+=decoder.decode();
      return {text,url,headers:response.headers,json(){return JSON.parse(text);}};
    }
    throw new Error('Too many redirects.');
  };
}
module.exports = { validateUrl, isPublicAddress, assertPublic, createFetcher };
