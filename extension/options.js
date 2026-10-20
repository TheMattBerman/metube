const DEFAULT_PROMPT = METUBE_QUALITY.prompt;
const $ = (id) => document.getElementById(id);
let selfie = null, selfieDirty=false, model = "berry";

function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }
function burst(el) {
  const r = el.getBoundingClientRect(), cols = ["#ff2d55", "#ff7a18", "#ffd60a", "#7c3aed"];
  for (let i = 0; i < 18; i++) {
    const d = document.createElement("i"), a = (i / 18) * Math.PI * 2, dist = 40 + Math.random() * 50;
    d.className = "burst"; d.style.background = cols[i % 4];
    d.style.left = r.left + r.width / 2 + "px"; d.style.top = r.top + r.height / 2 + "px";
    d.style.setProperty("--x", Math.cos(a) * dist + "px"); d.style.setProperty("--y", Math.sin(a) * dist + "px");
    document.body.appendChild(d); setTimeout(() => d.remove(), 900);
  }
}
function paintRange(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
function updateCost() {
  const n = Number($("maxThumbs").value);
  $("maxOut").textContent = n; $("concOut").textContent = $("concurrency").value;
  const c = $("cost"); c.textContent = n + " edits max";
  c.classList.remove("tick"); void c.offsetWidth; c.classList.add("tick");
  paintRange($("maxThumbs")); paintRange($("concurrency"));
}
function setModel(v) {
  model = v; $("model").classList.toggle("jam", v === "jam");
  $("model").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
}
function setSelfie(dataUrl, animate) {
  selfie = dataUrl; $("preview").src = dataUrl; $("drop").classList.add("has");
  if (animate) { const d = $("drop"); d.classList.remove("pop"); void d.offsetWidth; d.classList.add("pop"); burst(d); toast("Looking good. Obviously."); }
}

chrome.storage.local.get(null, (s) => {
  $("falKey").value = s.falKey || "";
  $("maxThumbs").value = s.maxThumbs || 12;
  $("hourlyLimit").value=s.hourlyLimit||s.maxThumbs||12;
  $("concurrency").value = s.concurrency || 3;
  $("prompt").value = s.prompt&&!s.prompt.startsWith('Replace only the identity')&&!s.prompt.startsWith('Edit ')?s.prompt:'';


  $("enabled").checked = s.enabled !== false;
  document.body.classList.toggle("off", s.enabled === false);
  setModel(s.model || "berry");
  if (s.selfie) setSelfie(s.selfie, false);
  const n = s.generatedCount || 0;
  $("stat").textContent = `${n} thumbnail${n === 1 ? "" : "s"} made about you`;
  updateCost();
});

function loadFile(f) {
  if (!f || !f.type.startsWith("image/")) return toast("That's not a picture of you.");
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    setSelfie(c.toDataURL("image/jpeg", 0.9), true);selfieDirty=true;
  };
  img.src = URL.createObjectURL(f);
}
const drop = $("drop");
drop.addEventListener("click", () => $("selfie").click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("selfie").click(); });
$("selfie").addEventListener("change", (e) => loadFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));

$("maxThumbs").addEventListener("input", updateCost);
$("concurrency").addEventListener("input", updateCost);
$("model").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setModel(b.dataset.v); });
$("eye").addEventListener("click", () => { const k = $("falKey"); const show = k.type === "password"; k.type = show ? "text" : "password"; $("eye").textContent = show ? "hide" : "show"; });

$("enabled").addEventListener("change", (e) => {
  const on = e.target.checked;
  document.body.classList.toggle("off", !on);
  chrome.storage.local.set({ enabled: on });
  if (on) burst(e.target.closest(".switch"));
  toast(on ? "MeTube on. It's all about you now." : "MeTube off. Back to other people. Ew.");
});

$("save").addEventListener("click", (e) => {
  chrome.storage.local.set({
    falKey: $("falKey").value.trim(),
    maxThumbs: Number($("maxThumbs").value) || 12,
    concurrency: Number($("concurrency").value) || 3,
    model,
    prompt: $("prompt").value.trim(),
    hourlyLimit:Math.max(1,Math.min(100,Number($("hourlyLimit").value)||12)),


    ...(selfieDirty ? {selfie,enabled:false,qualityApproved:0,testedQualityVersion:0} : {}),
  }, () => {selfieDirty=false; burst(e.target); toast("Saved ✦ Reload YouTube"); });
});
$("testOne").addEventListener("click", () => {
  const value = $("testVideo").value.trim();
  let videoId = /^[\w-]{11}$/.test(value) ? value : null;
  try {
    const url = new URL(value);
    if (["youtube.com", "www.youtube.com"].includes(url.hostname)) videoId = url.searchParams.get("v");
    if (url.hostname === "youtu.be") videoId = url.pathname.slice(1);
  } catch (_) {}
  if (!/^[\w-]{11}$/.test(videoId || "")) return toast("Enter a YouTube video URL or video ID.");
  const button = $("testOne");
  button.disabled = true;
  $("testResult").hidden = true;
  $("testStatus").textContent = "Checking for a face, then generating one preview…";
  chrome.runtime.sendMessage({ type: "metube:test", videoId }, (res) => {
    button.disabled = false;
    if (chrome.runtime.lastError || !res?.ok) {
      $("testStatus").textContent = chrome.runtime.lastError?.message || res?.error || "Preview failed.";
      return;
    }
    if (res.skipped) { $("testStatus").textContent = res.reason; return; }
    $("testOriginal").src = res.original;
    $("testReference").src = res.reference;
    $("testOutput").src = res.dataUrl;
    $("testResult").hidden = false;

    $("testStatus").textContent = (res.cached?"Saved preview loaded. ":"One preview complete. ")+"Review the automatic head edit before enabling the feed. Pixels outside the mask are preserved.";
  });
});
$("clear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "metube:clearCache" }, () => toast("Cache cleared. Fresh you incoming."));
});

chrome.storage.onChanged.addListener(c=>{
 if(c.selfie&&!selfieDirty){selfie=c.selfie.newValue||null;if(selfie)setSelfie(selfie,false);else{$('preview').removeAttribute('src');$('drop').classList.remove('has')}}
 if(c.enabled){$('enabled').checked=c.enabled.newValue!==false;document.body.classList.toggle('off',c.enabled.newValue===false)}
});
$('listJobs').onclick=async()=>{
 const r=await chrome.runtime.sendMessage({type:'metube:listJobs'});$('jobs').replaceChildren();
 for(const j of r.jobs||[]){const o=document.createElement('option');o.value=j.key;o.textContent=j.state+' · '+j.requestId+' · '+new Date(j.created).toLocaleString();$('jobs').append(o)}
 $('jobStatus').textContent=(r.jobs?.length||0)+' saved requests. Check fal request history before forgetting an unknown submission.';
};
$('forgetJob').onclick=async e=>{
 if(!e.isTrusted||!$('duplicateRisk').checked)return;
 const r=await chrome.runtime.sendMessage({type:'metube:forgetJob',key:$('jobs').value,acknowledgeDuplicateRisk:true});$('jobStatus').textContent=r.ok?'Receipt forgotten. A future attempt may create another paid request.':r.error;
};
