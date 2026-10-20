// MeTube content script: swaps logo + thumbnails.
(() => {
  let seen = new WeakMap();
  let epoch=0;
  const QUALITY_VERSION=5;
  let settings = { enabled: false, maxThumbs: 0 };
  let processed = 0;

  function videoIdFromSrc(src) {
    const m = /\/vi(?:_webp)?\/([\w-]{11})\//.exec(src || "");
    return m ? m[1] : null;
  }

  const compareHost=document.createElement('div');compareHost.id='metube-comparison';
  const compareRoot=compareHost.attachShadow({mode:'open'});
  compareRoot.innerHTML=`<style>:host{position:fixed;bottom:24px;left:80px;z-index:2147483644;font:12px system-ui;color:#eee}.switch{display:flex;align-items:center;gap:4px;padding:5px;border:1px solid #ffffff25;border-radius:100px;background:#1c1628ed;box-shadow:0 8px 30px #0005;backdrop-filter:blur(14px)}span{padding:0 9px;color:#c5a4ef;font-weight:700}button{font:inherit;border:0;background:transparent;color:#b0a3bf;border-radius:100px;padding:8px 15px;cursor:pointer}button[aria-pressed=true]{background:linear-gradient(110deg,#d5b2f7,#edb4c3);color:#25172f;font-weight:700}button:focus-visible{outline:2px solid #d5b2f7;outline-offset:3px}@media(max-width:600px){:host{left:12px;bottom:12px}span{display:none}}</style><div class="switch" role="group" aria-label="Thumbnail before and after"><span>✦ MeTube</span><button id="before" aria-pressed="false">Before</button><button id="after" aria-pressed="true">After</button></div>`;
  document.documentElement.append(compareHost);
  const comparison=new MeTubeComparison({videoIdFromSrc,onChange:mode=>{for(const name of ['before','after'])compareRoot.getElementById(name).setAttribute('aria-pressed',String(name===mode));}});
  for(const name of ['before','after'])compareRoot.getElementById(name).onclick=()=>comparison.show(name);
  function swapLogo() {
    document.querySelectorAll("ytd-topbar-logo-renderer #logo-icon, ytd-topbar-logo-renderer yt-icon#logo-icon").forEach((el) => {
      if (el.dataset.metube) return;
      el.dataset.metube = "1";
      el.style.display = "none";
      const logo = document.createElement("span");
      logo.className = "metube-logo mt-intro";
      logo.innerHTML = '<span class="mt-play"></span><span class="mt-word">Me<i>Tube</i></span>';
      el.parentElement.insertBefore(logo, el);
    });
    if (!document.title.includes("MeTube")) document.title = document.title.replace(/YouTube/g, "MeTube");
  }

  function candidates() {
    return document.querySelectorAll("ytd-thumbnail img, yt-thumbnail-view-model img, a#thumbnail img");
  }

  function handleImg(img) {
    if (!settings.enabled) return;
    const src = img.currentSrc || img.src;
    const vid = videoIdFromSrc(src);
    if (!vid || seen.get(img)===vid) return; // lazy-loaded, no src yet; observer catches the src change later
    if (processed >= settings.maxThumbs) return;
    seen.set(img,vid);
    processed++;
    const requestEpoch=epoch;
    img.classList.add("metube-pending");
    chrome.runtime.sendMessage({ type: "metube:generate", videoId: vid, thumbUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` }, (res) => {
      img.classList.remove("metube-pending");
      if(requestEpoch!==epoch)return;
      if (chrome.runtime.lastError || !res || !res.ok) {
        console.warn("[MeTube]", vid, chrome.runtime.lastError?.message || res?.error);
        return;
      }
      if (res.skipped) return;
      // A recycled tile must never receive an older video's face swap.
      if (videoIdFromSrc(img.currentSrc || img.src) !== vid) return;
      comparison.record(img,vid,res.dataUrl);
    });
  }

  let previewPanel;let previewDismissed=false;
  function ensurePreviewPanel(force=false){
    if((!force&&settings.qualityApproved===QUALITY_VERSION)||previewPanel||previewDismissed)return;
    const host=document.createElement('div');host.id='metube-preview-panel';
    const root=host.attachShadow({mode:'closed'});
    root.innerHTML=`<style>:host{position:fixed;bottom:18px;left:80px;z-index:2147483647;font:14px system-ui;color:#fff}section{width:310px;max-height:75vh;overflow:auto;padding:16px;border:1px solid #666;border-radius:14px;background:#191919;box-shadow:0 8px 30px #0009}button{font:inherit;color:#fff;background:#7346e5;border:0;border-radius:8px;padding:10px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}p{line-height:1.4}img{width:100%;border-radius:6px}small{color:#bbb}</style><section><button id="dismiss" aria-label="Hide preview panel" style="float:right;padding:2px 8px;background:#444">×</button><b>MeTube updated · feed paused</b><p>Optional preview pauses the feed while you inspect one image. Resume the full feed whenever you like.</p><input id="video" aria-label="Preview video ID" placeholder="Optional video ID" style="width:95%;padding:6px;margin-bottom:8px"><button id="test">Test one thumbnail</button><p id="status" role="status"></p><div id="result" hidden><small>Original</small><img id="before" alt="Original thumbnail"><small>MeTube preview</small><img id="after" alt="MeTube thumbnail preview"></div></section>`;
    document.documentElement.append(host);previewPanel=host;
    root.querySelector('#dismiss').onclick=()=>{previewDismissed=true;host.remove();previewPanel=null};
    let previewTarget=null;const skippedVideos=new Set();
    root.querySelector('#test').addEventListener('click',async(event)=>{
      if(!event.isTrusted)return;
      const button=root.querySelector('#test'),status=root.querySelector('#status');
      const requested=root.querySelector('#video').value.trim();
      if(requested&&!/^[\w-]{11}$/.test(requested)){status.textContent='Enter an 11-character YouTube video ID.';return;}
      const img=previewTarget?.img||Array.from(candidates()).find(i=>{const id=videoIdFromSrc(i.currentSrc||i.src);return id&&!skippedVideos.has(id)&&(!requested||id===requested)});
      const videoId=previewTarget?.videoId||requested||(img&&videoIdFromSrc(img.currentSrc||img.src));
      if(!videoId){status.textContent='No original thumbnail is available. Reload YouTube first.';return;}
      previewTarget={img,videoId};
      const previewEpoch=epoch;button.disabled=true;status.textContent='Selecting the head locally, then generating one preview…';
      const poll=setInterval(()=>chrome.runtime.sendMessage({type:'metube:progress',videoId}).then(p=>{if(p?.phase)status.textContent=p.phase}).catch(()=>{}),2000);
      try{
        const res=await chrome.runtime.sendMessage({type:'metube:test',videoId});
        if(previewEpoch!==epoch){status.textContent='Photo changed. Test the new photo.';previewTarget=null;return;}
        if(res?.videoId&&res.videoId!==videoId)throw Error('Preview video changed. Try again.');
        if(!res?.ok)throw Error(res?.error||'The extension did not respond.');
        if(res.skipped){status.textContent=res.reason;skippedVideos.add(videoId);previewTarget=null;button.textContent='Try another thumbnail';return;}
        root.querySelector('#before').src=res.original;root.querySelector('#after').src=res.dataUrl;root.querySelector('#result').hidden=false;
        // Show the installed extension's actual result on exactly one live thumbnail.
        if(img&&(videoIdFromSrc(img.currentSrc||img.src)===videoId||img.dataset.metubeVid===videoId))comparison.record(img,videoId,res.dataUrl);
        status.textContent=(res.cached?'Saved preview loaded. ':'One preview complete. ')+`Protected pixels changed: ${res.metrics?.protectedChanged??'unknown'}. Feed is still paused.`;
        button.textContent='Preview this image again';
        const enable=document.createElement('button');enable.textContent='Enable feed';enable.onclick=event=>{if(event.isTrusted)chrome.storage.local.set({enabled:true,qualityApproved:QUALITY_VERSION})};if(!root.querySelector('#enableFeed')){enable.id='enableFeed';root.querySelector('section').append(enable);}
      }catch(error){status.textContent=error.message;}
      finally{clearInterval(poll);button.disabled=false;}
    });
  }
  async function showPreview(){await chrome.storage.local.set({enabled:false});previewDismissed=false;ensurePreviewPanel(true)}
  const photoOverlay=installPhotoOverlay({
   getState:async()=>{const s=await chrome.storage.local.get(['selfie','enabled','qualityApproved','testedQualityVersion']);return{selfie:s.selfie,enabled:s.enabled!==false,canEnable:!!s.selfie}},
   setEnabled:async enabled=>chrome.storage.local.set({enabled,...(enabled?{qualityApproved:QUALITY_VERSION}:{})}),
   clearPhoto:async()=>chrome.storage.local.set({selfie:null,enabled:false,qualityApproved:0,testedQualityVersion:0}),
   savePhoto:async selfie=>chrome.storage.local.set({selfie,enabled:false,qualityApproved:0,testedQualityVersion:0}),
   onSaved:()=>{},showPreview
  });
  chrome.runtime.onMessage.addListener(msg=>{if(msg?.type==='metube:open-photo')photoOverlay.open()});
  function scan() { comparison.sweep(); swapLogo(); candidates().forEach(handleImg); }

  let t;
  const schedule = () => { clearTimeout(t); t = setTimeout(scan, 250); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  // SPA navigation: reset per-page budget
  document.addEventListener("yt-navigate-finish", () => { processed = 0; schedule(); });

  chrome.storage.local.get(["enabled", "maxThumbs", "qualityApproved"], (s) => {
    settings.enabled = s.enabled !== false;
    settings.qualityApproved = s.qualityApproved;
    settings.maxThumbs = Number(s.maxThumbs) || 12;
    scan();
  });
  chrome.storage.onChanged.addListener((c) => {
    if(c.selfie){epoch++;processed=0;seen=new WeakMap();comparison.clear();previewPanel?.remove();previewPanel=null;previewDismissed=false;}
    if(c.enabled&&c.enabled.newValue===false)epoch++;
    if(c.qualityApproved){settings.qualityApproved=c.qualityApproved.newValue;if(settings.qualityApproved===QUALITY_VERSION){previewPanel?.remove();previewPanel=null;}}
    if (c.enabled) settings.enabled = c.enabled.newValue !== false;
    if (c.maxThumbs) settings.maxThumbs = Number(c.maxThumbs.newValue) || 12;
    if(c.enabled||c.qualityApproved||c.selfie){seen=new WeakMap();processed=0;schedule();}
  });
})();
