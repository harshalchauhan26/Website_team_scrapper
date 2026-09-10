const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {scrapeStore,canonical}=require('./universal-scraper');
const {saveLibrary}=require('./library');
const terminal=new Set(['complete','error','cancelled']);
function createQueue({root,datasets,engine=scrapeStore}) {
  const dir=path.join(root,'.data'),file=path.join(dir,'jobs.json');
  const saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  const jobs=new Map(saved.map(job=>{
    if(!terminal.has(job.phase)){job.phase=job.phase==='cancelling'?'cancelled':'queued';for(const item of job.items)if(item.status==='running')item.status='queued';}
    return [job.id,job];
  }));
  let running=false,controller=null,runningId=null;
  const persist=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify([...jobs.values()]),'utf8');fs.renameSync(file+'.tmp',file);};
  async function drain(){
    if(running)return;running=true;
    try {
      for(const job of jobs.values()){
        if(job.phase!=='queued')continue;
        controller=new AbortController();runningId=job.id;job.phase='scraping';job.startedAt ||= new Date().toISOString();persist();
        for(let i=0;i<job.items.length;i++) {
          if(controller.signal.aborted)break;
          const item=job.items[i];if(terminal.has(item.status))continue;
          job.linkIndex=i+1;job.source=item.url;job.pages=0;job.completed=0;job.total=0;job.failed=0;item.status='running';persist();
          try {
            const result=await engine(item.url,{signal:controller.signal,maxPages:job.options.maxPages,browser:job.options.browser,onProgress:p=>Object.assign(job,p,{phase:controller.signal.aborted?'cancelling':'scraping'})});
            item.platform=result.platform;item.warnings=result.warnings||[];item.issues=result.issues||[];item.count=result.rows.length;
            if(result.rows.length){
              const parsed=new URL(item.url),name=decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop()||parsed.hostname).replace(/-/g,' ');
              const dataset={id:crypto.randomUUID(),name,source:item.url,sourceType:'Scraped collection',createdAt:new Date().toISOString(),rows:result.rows,failed:result.failed||0,platform:result.platform,warnings:item.warnings,jobId:job.id};
              saveLibrary(root,[dataset,...datasets]);datasets.unshift(dataset);item.datasetId=dataset.id;job.datasetId=dataset.id;
            }
            item.status=controller.signal.aborted?'cancelled':result.rows.length?'complete':'error';
            if(!result.rows.length)item.error=controller.signal.aborted?'Cancelled':'No product data found. The page may be blocked, require login, or use an unsupported layout.';
          }catch(e){item.status=controller.signal.aborted?'cancelled':'error';item.error=e.message;}
          item.finishedAt=new Date().toISOString();job.count=job.items.reduce((n,it)=>n+(it.count||0),0);job.linksCompleted=job.items.filter(it=>terminal.has(it.status)).length;persist();
        }
        if(controller.signal.aborted){job.phase='cancelled';job.items.filter(it=>it.status==='queued').forEach(it=>{it.status='cancelled';it.error='Cancelled before processing';});}
        else job.phase=job.items.some(it=>it.status==='complete')?'complete':'error';
        job.finishedAt=new Date().toISOString();job.error=job.phase==='error'?(job.items[0]?.error||'No products collected'):undefined;persist();
      }
    }catch(e){
      const job=jobs.get(runningId);if(job){job.phase='error';job.error='Could not save run state: '+e.message;}
      console.error('Queue error:',e.message);
    }finally{running=false;runningId=null;controller=null;}
  }
  function submit(urls,options={}) {
    const unique=[...new Set(urls.map(u=>u.trim()).filter(Boolean))];
    if(!unique.length)throw new Error('Paste at least one website or product URL.');
    const job={id:crypto.randomUUID(),phase:'queued',source:unique[0],createdAt:new Date().toISOString(),count:0,linksCompleted:0,linkIndex:0,items:unique.map(url=>({url,status:'queued'})),options:{maxPages:options.maxPages||0,browser:options.browser!==false}};
    jobs.set(job.id,job);
    try{persist();}catch(e){jobs.delete(job.id);throw e;}
    setImmediate(()=>void drain());return job;
  }
  function cancel(id){const job=jobs.get(id);if(!job)return null;if(!terminal.has(job.phase)){
    if(id===runningId){job.phase='cancelling';controller.abort(new Error('Cancelled by user'));}
    else{job.phase='cancelled';job.items.forEach(it=>{it.status='cancelled';it.error='Cancelled before processing';});}
    persist();}return job;
  }
  function exportRows(id){const job=jobs.get(id);if(!job)return null;const rows=new Map();for(const item of job.items){const dataset=datasets.find(d=>d.id===item.datasetId);for(const r of dataset?.rows||[]){const key=canonical(r.url);if(!rows.has(key))rows.set(key,{...r,attributes:{...r.attributes,'Input URL':item.url,Platform:item.platform||''}});}}return [...rows.values()];}
  setImmediate(()=>void drain());
  return {jobs,submit,cancel,exportRows};
}
module.exports={createQueue,terminal};
