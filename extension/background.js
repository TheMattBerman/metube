// MeTube service worker: calls Krea 3 after a local face check.
importScripts("quality.js");
const MODEL = "krea/v3/edit";
const DEFAULT_PROMPT = METUBE_QUALITY.prompt;

// Fresh installs start paused. Existing user photos and keys are never seeded from the package.
const updateReady=(async()=>{
 const s=await chrome.storage.local.get(['metubeUpdateVersion']);
 if(s.metubeUpdateVersion!==5)await chrome.storage.local.set({enabled:false,metubeUpdateVersion:5});
})();
updateReady.catch(()=>{});

// ---------- IndexedDB cache ----------
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("metube", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("thumbs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cacheGet(k) {
  const d = await db();
  return new Promise((res) => { const q = d.transaction("thumbs").objectStore("thumbs").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
}
async function cacheSet(k, v) {
  const d = await db();
  return new Promise((res,rej) => { const tx = d.transaction("thumbs", "readwrite"); tx.objectStore("thumbs").put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function cacheClear() {
  const d = await db();
  return new Promise((res) => { const tx = d.transaction("thumbs", "readwrite"); tx.objectStore("thumbs").clear(); tx.oncomplete = res; });
}

// ---------- concurrency limiter ----------
let active = 0;
const queue = [];
const inflight = new Map();
const previewProgress=new Map();
async function limit(fn, max) {
  if (active >= max) await new Promise((r) => queue.push(r));
  else active++;
  try { return await fn(); } finally { const n = queue.shift(); if (n) n(); else active--; }
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(s)}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let visionCreation;
async function vision(action,payload={}){
 const localPhase=text=>{for(const id of previewProgress.keys())previewProgress.set(id,text)};
 const deadline=(promise,message)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),15000)})]).finally(()=>clearTimeout(timer));};
 const url=chrome.runtime.getURL('vision.html');
 localPhase('Checking the local processor document…');
 if(!(await deadline(chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]}),'Comet did not return local processor status. No Krea request was submitted.')).length){
  localPhase('Starting the local processor document…');
  if(!visionCreation)visionCreation=deadline(chrome.offscreen.createDocument({url:'vision.html',reasons:['BLOBS'],justification:'Detect head regions and composite generated thumbnail crops locally.'}),'Comet could not start its local processor. No Krea request was submitted.').finally(()=>{visionCreation=null});
  await visionCreation;
 }
 localPhase('Running local '+action+' operation…');
 let timer;
 const result=await Promise.race([chrome.runtime.sendMessage({target:'metube-vision',action,...payload}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Local vision processing timed out. No new Krea request was submitted.')),60000)})]).finally(()=>clearTimeout(timer));
 if(!result?.ok)throw Error(result?.error||'Local image processing did not respond. No automatic resubmission.');
 return result;
}
let submissionTail=Promise.resolve();
async function reserveSubmission(jobKey,validate){
 const work=submissionTail.then(async()=>{
  if((await chrome.storage.local.get(jobKey))[jobKey])throw Error('This edit already has a saved request. Retry resumes it without a new submission.');
  await validate();
  const s=await chrome.storage.local.get(['spendWindow','hourlyLimit','maxThumbs']);
  const now=Date.now(),ledger=s.spendWindow&&now-s.spendWindow.start<3600000?s.spendWindow:{start:now,count:0};
  const cap=Math.max(1,Math.min(100,Number(s.hourlyLimit)||Number(s.maxThumbs)||12));
  if(ledger.count>=cap)throw Error('Hourly generation limit reached. Cached results and Before/After still work. Try after the hour resets.');
  await chrome.storage.local.set({spendWindow:{start:ledger.start,count:ledger.count+1},[jobKey]:{state:'submitting',created:now}});
 });submissionTail=work.catch(()=>{});await work;
}
const paidEdits=new Map();
function falEdit(args){let p=paidEdits.get(args.jobKey);if(!p){p=falEditOnce(args).finally(()=>paidEdits.delete(args.jobKey));paidEdits.set(args.jobKey,p)}return p;}
async function falEditOnce({key,prompt,imageUrls,model,imageSize,jobKey,validate=async()=>{},onProgress=()=>{}}){
 const headers={Authorization:`Key ${key}`,'Content-Type':'application/json'};
 let job=(await chrome.storage.local.get(jobKey))[jobKey];
 if(job?.state==='submitting')throw Error('An earlier submission has an unknown outcome. MeTube will not create a duplicate charge.');
 if(!job){
  // Persist intent before submitting. A worker restart cannot silently create another paid request.
  await reserveSubmission(jobKey,validate);
  try{await validate()}catch(e){await chrome.storage.local.remove(jobKey);throw e}
  let response;
  try{response=await fetch(`https://queue.fal.run/${MODEL}`,{method:'POST',headers,body:JSON.stringify({prompt,image_urls:imageUrls,model,reasoning_level:'medium',image_size:imageSize,output_format:'jpeg'})});}
  catch(_){throw Error('Submission status is unknown. MeTube will not retry the paid request automatically.');}
  if(!response.ok){if([400,401,403,404,405,413,415,422,429].includes(response.status))await chrome.storage.local.remove(jobKey);throw Error(`fal submit ${response.status}. Ambiguous outcomes retain their receipt; check saved request recovery.`);}
  const queued=await response.json();
  let valid=false;try{valid=['status_url','response_url'].every(k=>typeof queued?.[k]==='string'&&new URL(queued[k]).origin==='https://queue.fal.run')}catch{}
  job={...queued,state:valid?'queued':'submitting',created:Date.now()};await chrome.storage.local.set({[jobKey]:job});
  if(!valid)throw Error('Queue receipt was incomplete. Submission outcome is unknown; check saved request recovery. No automatic resubmission.');
 }
 for(const url of [job.status_url,job.response_url])if(typeof url!=='string'||new URL(url).origin!=='https://queue.fal.run')throw Error('Saved request has an unexpected queue host. Use request recovery in options.');
 if(job.state==='failed')throw Error('This Krea request failed. No automatic paid retry was made.');
 onProgress("Krea request saved; waiting for the result…");
 let complete=false;
 for(let i=0;i<120;i++){
  const response=await fetch(job.status_url,{headers});if(!response.ok)throw Error(`fal status ${response.status}. Retry resumes the same request.`);
  const status=await response.json();
  onProgress(status.status==='IN_QUEUE'?`Krea queued${Number.isFinite(status.queue_position)?' · position '+status.queue_position:''}. The same request will be resumed.`:'Krea is generating the preview…');
  if(status.status==='COMPLETED'){complete=true;break;}
  if(status.status==='FAILED'||status.error){await chrome.storage.local.set({[jobKey]:{...job,state:'failed'}});throw Error('Krea generation failed. No automatic paid retry.');}
  await sleep(2000);
 }
 if(!complete)throw Error('Krea is still queued or processing. Retry will resume this same request, without a new charge.');
 const response=await fetch(job.response_url,{headers});if(!response.ok)throw Error(`fal result ${response.status}. Retry resumes the same request.`);
 const out=await response.json(),url=out?.images?.[0]?.url;
 if(!url)throw Error('Krea returned no image. The existing request is retained.');
 const host=new URL(url);if(host.protocol!=='https:'||!(host.hostname==='fal.media'||host.hostname.endsWith('.fal.media')))throw Error('Unexpected image host.');
 return{url,requestId:job.request_id};
}

async function sourceThumbnail(videoId) {
  if (!/^[\w-]{11}$/.test(videoId || "")) throw new Error("Invalid YouTube video ID.");
  for (const name of ["maxresdefault", "hq720", "hqdefault"]) {
    const response = await fetch(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`);
    if (!response.ok) continue;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const valid = bitmap.width >= 320;
    bitmap.close();
    if (valid) return blob;
  }
  throw new Error("Could not load the original thumbnail.");
}

async function generate(videoId, _thumbUrl, test = false) {
  await updateReady;
  const s = await chrome.storage.local.get(["falKey", "selfie", "prompt", "concurrency", "model", "qualityApproved", "enabled"]);
  // An update must not regenerate the user's feed before the one-image review.
  if (!test && (s.enabled === false)) return { ok: true, skipped: true, reason: "Feed is paused. Resume it from the MeTube overlay." };
  if (!s.falKey) throw new Error("No fal API key. Open MeTube options.");
  if (!s.selfie) throw new Error("No selfie uploaded. Open MeTube options.");
  return limit(async()=>{
   const current=await chrome.storage.local.get(['selfie','enabled','qualityApproved']);
   if(current.selfie!==s.selfie||(!test&&(current.enabled===false)))return{ok:true,skipped:true,reason:'Photo or feed settings changed.'};
   const progress=text=>{if(test)previewProgress.set(videoId,text)};
   progress('Loading the original thumbnail…');
   const originalBlob=await sourceThumbnail(videoId),original=await blobToDataUrl(originalBlob);
   progress('Selecting the head and protecting foreground objects locally…');
   const region=await vision('prepare',{original});
   if(region.skipped)return region;
   try{
    progress('Preparing the saved selfie locally…');
    const {reference}=await vision('reference',{selfie:s.selfie});
    const key=await METUBE_QUALITY.cacheKey(videoId,s,reference,original),cacheKey='edit:'+key;
    const hit=await cacheGet(cacheKey);
    if(hit){if(test&&(await chrome.storage.local.get('selfie')).selfie===s.selfie)await chrome.storage.local.set({testedQualityVersion:METUBE_QUALITY.version});return{ok:true,...hit,videoId,original,...(test?{reference}:{}),cached:true};}
    const jobKey='pending:'+cacheKey;
    const result=await falEdit({key:s.falKey,prompt:METUBE_QUALITY.effectivePrompt(s.prompt),imageUrls:[region.cropDataUrl,reference],model:s.model||'berry',imageSize:region.outputSize,jobKey,validate:async()=>{const latest=await chrome.storage.local.get(['selfie','enabled']);if(latest.selfie!==s.selfie||(!test&&latest.enabled===false))throw Error('Photo or feed settings changed. No generation submitted.');},onProgress:progress});
    const response=await fetch(result.url);if(!response.ok)throw Error('Could not download the completed image. Retry resumes the existing request.');
    progress('Blending the completed crop into the original thumbnail…');
    const composite=await vision('composite',{token:region.token,edited:await blobToDataUrl(await response.blob())});
    const value={dataUrl:composite.dataUrl,metrics:composite.metrics,requestId:result.requestId,videoId,original,mask:composite.mask};
    // Cache before clearing the receipt so an interrupted worker cannot resubmit the edit.
    await cacheSet(cacheKey,value);
    const {generatedCount=0}=await chrome.storage.local.get('generatedCount');
    await chrome.storage.local.set({generatedCount:generatedCount+1,...(test&&(await chrome.storage.local.get('selfie')).selfie===s.selfie?{testedQualityVersion:METUBE_QUALITY.version}: {})});
    await chrome.storage.local.remove(jobKey);
    return{ok:true,...value,...(test?{reference}:{})};
   }finally{await vision('release',{token:region.token}).catch(()=>{});}
  },Math.max(1,Math.min(3,Number(s.concurrency)||2)));
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if(msg?.type==='metube:vision-progress'&&_sender.id===chrome.runtime.id){for(const id of previewProgress.keys())previewProgress.set(id,msg.phase);return;}
  if(msg?.type==='metube:progress'&&_sender.id===chrome.runtime.id&&/^https:\/\/www\.youtube\.com\//.test(_sender.url||'')){reply({phase:previewProgress.get(msg.videoId)||'Preparing preview…'});return;}
  if (msg?.type === "metube:generate" || msg?.type === "metube:test") {
    const test = msg.type === "metube:test";
    const youtube=!!_sender.tab&&/^https:\/\/www\.youtube\.com\//.test(_sender.url||'');
    const options=_sender.url===chrome.runtime.getURL('options.html');
    if(_sender.id!==chrome.runtime.id||(!youtube&&!options)){reply({ok:false,error:'Unsupported sender.'});return;}
    (async()=>{
     const snapshot=await chrome.storage.local.get(['selfie','prompt','model']);
     const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)));
     const id=(test?'test:':'feed:')+msg.videoId+':'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
     let p=inflight.get(id);
     if(!p){p=generate(msg.videoId,msg.thumbUrl,test).finally(()=>inflight.delete(id));inflight.set(id,p);}
     return p;
    })().then(reply).catch(e=>reply({ok:false,error:String(e.message||e)}));
    return true;
  }
  if(['metube:listJobs','metube:forgetJob'].includes(msg?.type)&&_sender.id===chrome.runtime.id&&_sender.url===chrome.runtime.getURL('options.html')){
   (async()=>{const all=await chrome.storage.local.get(null);const jobs=Object.entries(all).filter(([k])=>k.startsWith('pending:'));
    if(msg.type==='metube:listJobs')return{ok:true,jobs:jobs.map(([key,j])=>({key,state:j.state,created:j.created,requestId:j.request_id||'unknown'}))};
    if(msg.acknowledgeDuplicateRisk!==true||!jobs.some(([k])=>k===msg.key))throw Error('Select a saved request and acknowledge duplicate-charge risk.');
    await chrome.storage.local.remove(msg.key);return{ok:true};
   })().then(reply).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if (msg?.type === "metube:clearCache" && _sender.id===chrome.runtime.id && _sender.url===chrome.runtime.getURL("options.html")) { cacheClear().then(() => reply({ ok: true })); return true; }
});

chrome.action.onClicked.addListener(async(tab)=>{
 if(/^https:\/\/www\.youtube\.com\//.test(tab?.url||'')){
  try{await chrome.tabs.sendMessage(tab.id,{type:'metube:open-photo'});return}catch{}
 }
 chrome.runtime.openOptionsPage();
});
self.DEFAULT_PROMPT = DEFAULT_PROMPT;
