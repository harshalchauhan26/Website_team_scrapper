const fs = require('node:fs');
const { chromium } = require('playwright');
const { assertPublic } = require('./web-fetch');

// A separate, clean browser context. Never reads the user's cookies or profile.
async function createRenderer(signal) {
  const executablePath = [process.env.ATELIER_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p && fs.existsSync(p));
  const browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
  const context = await browser.newContext({serviceWorkers:'block'});
  const checked = new Map();
  await context.route('**/*',async route=>{
    try {
      if (signal?.aborted || ['image','media','font'].includes(route.request().resourceType())) return route.abort();
      const url=route.request().url(), origin=new URL(url).origin;
      if (!checked.has(origin)) checked.set(origin,assertPublic(url));
      await checked.get(origin); await route.continue();
    } catch { await route.abort().catch(()=>{}); }
  });
  const abort = ()=>{void browser.close().catch(()=>{});}; signal?.addEventListener('abort',abort,{once:true});
  return {
    async render(url) {
      signal?.throwIfAborted(); await assertPublic(url);
      const page=await context.newPage();
      try {
        const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        if(response && response.status()>=400) throw new Error(`Browser received HTTP ${response.status()}`);
        await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
        const snapshots=[]; let unchanged=0,last='',limitReached=false;
        for(let step=0;step<20;step++) {
          signal?.throwIfAborted();
          const html=await page.content(); snapshots.push(html);
          const signature=await page.locator('body').innerText({timeout:3000}).catch(()=>'');
          unchanged=signature===last ? unchanged+1 : 0; last=signature;
          if(unchanged>=2) break;
          const load=page.getByRole('button',{name:/^(load|show|view) more( products| items)?$/i}).first();
          if(await load.isVisible().catch(()=>false)) await load.click({timeout:2500}).catch(()=>{});
          else await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
          await page.waitForTimeout(700);
          if(step===19) limitReached=true;
        }
        snapshots.push(await page.content());
        return {text:snapshots.join('\n'),url:page.url(),limitReached};
      } finally { await page.close().catch(()=>{}); }
    },
    async close(){signal?.removeEventListener('abort',abort);await browser.close().catch(()=>{});}
  };
}
module.exports={createRenderer};
