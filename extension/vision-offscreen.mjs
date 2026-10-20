import{prepare,reference,composite,setProgress}from'./vision-engine.mjs';
setProgress(phase=>chrome.runtime.sendMessage({type:'metube:vision-progress',phase}).catch(()=>{}));
const regions=new Map();let tail=Promise.resolve();
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(msg?.target!=='metube-vision'||sender.id!==chrome.runtime.id||sender.tab)return;
 const task=async()=>{
  for(const[token,item]of regions)if(Date.now()-item.created>20*60*1000)regions.delete(token);
  if(msg.action==='reference')return{ok:true,reference:await reference(msg.selfie)};
  if(msg.action==='prepare'){
   const region=await prepare(msg.original);
   if(region.skipped)return{ok:true,...region};
   if(regions.size>=8)throw Error('Image processing is busy. No new generation was submitted.');
   const token=crypto.randomUUID();regions.set(token,{region,created:Date.now()});
   return{ok:true,token,cropDataUrl:region.cropDataUrl,outputSize:region.outputSize,crop:region.crop};
  }
  if(msg.action==='release'){regions.delete(msg.token);return{ok:true};}
  if(msg.action==='composite'){
   const item=regions.get(msg.token);if(!item)throw Error('Local image context expired. Retry to resume the saved Krea request.');
   try{return{ok:true,...await composite(item.region,msg.edited)}}finally{regions.delete(msg.token)}
  }
  throw Error('Unknown image operation.');
 };
 const result=tail.then(task);tail=result.catch(()=>{});
 result.then(reply).catch(e=>reply({ok:false,error:e.message}));return true;
});
