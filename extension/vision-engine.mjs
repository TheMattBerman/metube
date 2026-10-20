import {selectFace} from './vision/region-core.mjs';
import {FilesetResolver,FaceLandmarker,ImageSegmenter,HandLandmarker} from './vision/vision_bundle.mjs';
let initPromise;
let progress=()=>{};
export function setProgress(callback){progress=callback;}
async function models(){
 if(!initPromise)initPromise=(async()=>{
  progress('Loading the bundled vision runtime…');
  const vision=await FilesetResolver.forVisionTasks(new URL('./vision/wasm',import.meta.url).href);
  progress('Loading the local face model…');
  const face=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./vision/models/face_landmarker.task',import.meta.url).href,delegate:'CPU'},numFaces:5,runningMode:'IMAGE',minFaceDetectionConfidence:.4,minFacePresenceConfidence:.4});
  progress('Loading the local segmentation model…');
  const seg=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./vision/models/selfie_multiclass.tflite',import.meta.url).href,delegate:'CPU'},runningMode:'IMAGE',outputCategoryMask:true,outputConfidenceMasks:false});
  progress('Loading the local hand model…');
  const hands=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./vision/models/hand_landmarker.task',import.meta.url).href,delegate:'CPU'},numHands:4,runningMode:'IMAGE',minHandDetectionConfidence:.35,minHandPresenceConfidence:.35});
  progress('Local vision models ready. Selecting the head…');
  return{face,seg,hands};
 })().catch(e=>{initPromise=null;throw e});
 return initPromise;
}
async function image(dataUrl){
 const blob=await(await fetch(dataUrl)).blob();
 const bitmap=await createImageBitmap(blob);
 const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
 canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
 canvas.naturalWidth=canvas.width;canvas.naturalHeight=canvas.height;return canvas;
}
export async function prepare(dataUrl){
 progress('Decoding the thumbnail locally…');
 const im=await image(dataUrl);const {face,seg,hands}=await models();
  const w=im.naturalWidth,h=im.naturalHeight;
  progress('Detecting the face…');
  const detection=face.detect(im);
  let {faces,selected}=selectFace(detection.faceLandmarks,w,h);
  let segmentationFallback=false;
  if(!selected){
   const sg=seg.segment(im),a=sg.categoryMask.getAsUint8Array(),sw=sg.categoryMask.width,sh=sg.categoryMask.height,labels=seg.getLabels();
   let x0=w,y0=h,x1=0,y1=0,count=0;
   for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(labels[a[y*sw+x]]==='face-skin'){
    const px=x*w/sw,py=y*h/sh;x0=Math.min(x0,px);y0=Math.min(y0,py);x1=Math.max(x1,px);y1=Math.max(y1,py);count++;
   }
   sg.close();let bw=x1-x0,bh=y1-y0;
   // A visible forehead can survive title occlusion while facial landmarks fail.
   // Bound an inferred head around that skin region; foreground title stays protected.
   if(bw/bh>=1.5&&count/(sw*sh)>.005){const center=(x0+x1)/2;bw*=1.3;bh=bw*1.4;x0=center-bw/2;x1=center+bw/2;y1=Math.min(h,y0+bh);bh=y1-y0;}
   if(count/(sw*sh)>.005&&bw>=64&&bh>=64&&bw<w*.65&&bh<h*.85&&bw/bh>.4&&bw/bh<1.5){
    const box={x:x0,y:y0,right:x1,bottom:y1,width:bw,height:bh};
    selected={box,index:-1,oval:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]};segmentationFallback=true;
   }
  }
  if(!selected)return {skipped:true,reason:'No complete, clear human face detected. Original kept.'};
  progress('Protecting foreground hands…');
  const handResult=hands.detect(im);
  // Local hand detector gets overlapping context windows for large or partly clipped hands.
  for(const [fx,fy] of [[0,0],[.35,0],[0,.35],[.35,.35]]){
   const hc=document.createElement('canvas');hc.width=Math.round(w*.65);hc.height=Math.round(h*.65);
   hc.getContext('2d').drawImage(im,fx*w,fy*h,hc.width,hc.height,0,0,hc.width,hc.height);
   const local=hands.detect(hc);
   for(const points of local.landmarks)handResult.landmarks.push(points.map(p=>({...p,x:fx+p.x*.65,y:fy+p.y*.65})));
  }
  const handCanvas=document.createElement('canvas');handCanvas.width=w;handCanvas.height=h;const hctx=handCanvas.getContext('2d');
  function convexHull(ps){const a=ps.slice().sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);const lo=[],hi=[];for(const p of a){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p)}for(const p of a.slice().reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p)}return lo.slice(0,-1).concat(hi.slice(0,-1))}
  for(const landmarks of handResult.landmarks){const hull=convexHull(landmarks.map(p=>({x:p.x*w,y:p.y*h})));hctx.beginPath();hull.forEach((p,i)=>i?hctx.lineTo(p.x,p.y):hctx.moveTo(p.x,p.y));hctx.closePath();hctx.fill();hctx.lineWidth=20;hctx.stroke();}
  const handPixels=hctx.getImageData(0,0,w,h).data;
  // Protect connected white title lettering even when it crosses the face.
  const originalPixels=im.getContext('2d').getImageData(0,0,w,h).data,textPixels=new Uint8Array(w*h),visited=new Uint8Array(w*h);
  const white=i=>originalPixels[i*4]>224&&originalPixels[i*4+1]>224&&originalPixels[i*4+2]>224;
  for(let i=0;i<w*h;i++)if(!visited[i]&&white(i)){
   const cluster=[i];visited[i]=1;
   for(let q=0;q<cluster.length;q++){const j=cluster[q],x=j%w,y=Math.floor(j/w);for(const k of [x>0?j-1:-1,x<w-1?j+1:-1,y>0?j-w:-1,y<h-1?j+w:-1])if(k>=0&&!visited[k]&&white(k)){visited[k]=1;cluster.push(k)}}
   if(cluster.length>Math.max(800,w*h*.003))for(const j of cluster)textPixels[j]=1;
  }
  const b=selected.box,cx=(b.x+b.right)/2,cy=(b.y+b.bottom)/2;
  const neckX=segmentationFallback?cx:detection.faceLandmarks[selected.index][152].x*w;
  progress('Separating hair, skin and foreground objects…');
  const segmented=seg.segment(im),raw=segmented.categoryMask.getAsUint8Array(),sw=segmented.categoryMask.width,sh=segmented.categoryMask.height;
  // Labels from Google's model: background, hair, body-skin, face-skin, clothes, others.
  const labels=seg.getLabels();
  const labelAt=(x,y)=>labels[raw[Math.min(sh-1,Math.floor(y*sh/h))*sw+Math.min(sw-1,Math.floor(x*sw/w))]];
  const hairRegion=new Uint8Array(w*h),queue=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   if(labelAt(x,y)==='hair'&&Math.abs(x-cx)<b.width*.75&&y>b.y-b.height*.7&&y<b.bottom){hairRegion[y*w+x]=1;queue.push(y*w+x);}
  }
  for(let q=0;q<queue.length;q++){
   const i=queue[q],x=i%w,y=Math.floor(i/w);
   for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
    if(nx<0||nx>=w||ny<0||ny>=h||Math.abs(nx-cx)>b.width*1.4||ny<b.y-b.height||ny>b.bottom+b.height*1.5)continue;
    const j=ny*w+nx;if(!hairRegion[j]&&labelAt(nx,ny)==='hair'){hairRegion[j]=1;queue.push(j);}
   }
  }
  const ellipse={cx,cy:cy-b.height*.14,rx:b.width*.70,ry:b.height*.85};
  const mask=document.createElement('canvas');mask.width=w;mask.height=h;const ctx=mask.getContext('2d');
  const faceCanvas=document.createElement('canvas');faceCanvas.width=w;faceCanvas.height=h;const fctx=faceCanvas.getContext('2d');
  fctx.beginPath();selected.oval.forEach((p,i)=>i?fctx.lineTo(p.x,p.y):fctx.moveTo(p.x,p.y));fctx.closePath();fctx.fill();const facePixels=fctx.getImageData(0,0,w,h).data;
  const pixels=ctx.createImageData(w,h);let minX=w,minY=h,maxX=0,maxY=0;
  const protect=document.createElement('canvas');protect.width=w;protect.height=h;const pctx=protect.getContext('2d');const pp=pctx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,label=labelAt(x,y),inFace=facePixels[i*4+3]>0;
   const inHead=((x-ellipse.cx)/ellipse.rx)**2+((y-ellipse.cy)/ellipse.ry)**2<=1;
   const inNeck=y>=b.bottom-b.height*.18&&y<=b.bottom+b.height*.35&&Math.abs(x-neckX)<=b.width*.24;
   // Face interior can replace glasses. Else preserve clothing, hands and foreground objects.
   const nearHead=Math.abs(x-cx)<=b.width*.95&&y>=b.y-b.height*.85&&y<=b.bottom+b.height*.08;
   const glassesBand=y>=b.y+b.height*.10&&y<=b.y+b.height*.55&&Math.abs(x-cx)<=b.width*.65;
   const beardZone=y>=b.bottom-b.height*.3&&y<=b.bottom+b.height*.8&&Math.abs(x-neckX)<=b.width*.6&&['hair','face-skin','body-skin'].includes(label);
   const chosen=hairRegion[i]||beardZone||inFace||(nearHead&&['hair','face-skin'].includes(label))||(inNeck&&label==='body-skin')||(glassesBand&&label==='others');
   const anotherFace=faces.some(f=>f.index!==selected.index&&x>=f.box.x-f.box.width*.25&&x<=f.box.right+f.box.width*.25&&y>=f.box.y-f.box.height*.5&&y<=f.box.bottom+f.box.height*.2);
   const protectedPixel=anotherFace||textPixels[i]||handPixels[i*4+3]>0||(!inFace&&!glassesBand&&(['clothes','others'].includes(label)||(label==='body-skin'&&!inNeck&&!beardZone)));
   if(chosen&&!protectedPixel){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
   pixels.data[i*4+3]=255;
   if(protectedPixel)pp.data[i*4]=pp.data[i*4+1]=pp.data[i*4+2]=255;
   pp.data[i*4+3]=255;
  }
  // Grow the original head silhouette slightly into background for a natural new outline.
  const radius=Math.max(3,Math.min(16,Math.round(b.width*.035)));const expanded=new Uint8Array(w*h),horizontal=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let hit=0;for(let k=Math.max(0,x-radius);k<=Math.min(w-1,x+radius);k++)if(pixels.data[(y*w+k)*4]){hit=1;break}horizontal[y*w+x]=hit;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let hit=0;for(let k=Math.max(0,y-radius);k<=Math.min(h-1,y+radius);k++)if(horizontal[k*w+x]){hit=1;break}expanded[y*w+x]=hit;}
  for(let i=0;i<w*h;i++){const value=expanded[i]&&!pp.data[i*4]?255:0;pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=value;}
  ctx.putImageData(pixels,0,0);pctx.putImageData(pp,0,0);
  // Context crop around the detected face; no thumbnail-specific coordinates.
  const left=Math.max(0,Math.min(Math.floor(cx-b.width*1.30),minX-24)),top=Math.max(0,Math.min(Math.floor(cy-b.height*1.15),minY-24));
  const right=Math.min(w,Math.max(Math.ceil(cx+b.width*1.30),maxX+24)),bottom=Math.min(h,Math.max(Math.ceil(b.bottom+b.height*1.10),maxY+24));
  const crop={x:left,y:top,width:right-left,height:bottom-top};
  const cropCanvas=document.createElement('canvas');cropCanvas.width=Math.ceil(crop.width/16)*16;cropCanvas.height=Math.ceil(crop.height/16)*16;
  cropCanvas.getContext('2d').drawImage(im,left,top,crop.width,crop.height,0,0,cropCanvas.width,cropCanvas.height);

  const result={original:im,mask,protect,crop,outputSize:{width:cropCanvas.width,height:cropCanvas.height},faceBox:b,cropDataUrl:cropCanvas.toDataURL('image/jpeg',.97),handsDetected:handResult.landmarks.length,segmentationFallback};
  segmented.close();
  return result;
}
export async function reference(dataUrl){
 const im=await image(dataUrl),{face}=await models();
 const {selected}=selectFace(face.detect(im).faceLandmarks,im.naturalWidth,im.naturalHeight);
 if(!selected)throw Error('Upload a clear selfie with one prominent face. No Krea request was made.');
 const b=selected.box,pad=.12*Math.max(b.width,b.height);
 const x=Math.max(0,Math.floor(b.x-pad)),y=Math.max(0,Math.floor(b.y-pad));
 const right=Math.min(im.naturalWidth,Math.ceil(b.right+pad)),bottom=Math.min(im.naturalHeight,Math.ceil(b.bottom+pad));
 const c=document.createElement('canvas');c.width=right-x;c.height=bottom-y;c.getContext('2d').drawImage(im,x,y,c.width,c.height,0,0,c.width,c.height);
 return c.toDataURL('image/jpeg',.95);
}
function blurred(canvas,radius,invert=false){
 const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d');
 if(invert){const src=canvas.getContext('2d').getImageData(0,0,c.width,c.height);for(let i=0;i<src.data.length;i+=4){src.data[i]=src.data[i+1]=src.data[i+2]=255-src.data[i];src.data[i+3]=255;}const t=document.createElement('canvas');t.width=c.width;t.height=c.height;t.getContext('2d').putImageData(src,0,0);canvas=t;}
 ctx.filter=`blur(${radius}px)`;ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,c.width,c.height).data;
}
export async function composite(region,editedDataUrl){
 const im=region.original,w=im.naturalWidth,h=im.naturalHeight,c=region.crop,edited=await image(editedDataUrl);
 if(edited.naturalWidth!==region.outputSize.width||edited.naturalHeight!==region.outputSize.height)throw Error('Unexpected Krea output size. Original kept.');
 const output=document.createElement('canvas');output.width=w;output.height=h;const ctx=output.getContext('2d');ctx.drawImage(im,0,0);const original=ctx.getImageData(0,0,w,h),result=ctx.getImageData(0,0,w,h);
 const layer=document.createElement('canvas');layer.width=w;layer.height=h;const lctx=layer.getContext('2d');lctx.drawImage(im,0,0);lctx.drawImage(edited,c.x,c.y,c.width,c.height);const layerPixels=lctx.getImageData(0,0,w,h).data;
 const radius=Math.max(5,Math.min(12,region.faceBox.width*.025)),mask=blurred(region.mask,radius),safe=blurred(region.protect,radius,true),protect=region.protect.getContext('2d').getImageData(0,0,w,h).data;
 let changedPixels=0,protectedChanged=0,outsideChanged=0;
 const finalMask=document.createElement('canvas');finalMask.width=w;finalMask.height=h;const mctx=finalMask.getContext('2d'),maskPixels=mctx.createImageData(w,h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,inside=x>=c.x&&x<c.x+c.width&&y>=c.y&&y<c.y+c.height;
  const a=inside&&!protect[i]?Math.floor(mask[i]*Math.max(0,Math.min(1,(safe[i]-128)/127))):0;
  maskPixels.data[i]=maskPixels.data[i+1]=maskPixels.data[i+2]=a;maskPixels.data[i+3]=255;
  for(let k=0;k<3;k++)result.data[i+k]=Math.round((original.data[i+k]*(255-a)+layerPixels[i+k]*a)/255);
  const changed=[0,1,2].some(k=>result.data[i+k]!==original.data[i+k]);if(changed)changedPixels++;
  if(changed&&protect[i])protectedChanged++;if(changed&&a===0)outsideChanged++;
 }
 if(protectedChanged||outsideChanged)throw Error('Composite preservation check failed. Original kept.');
 ctx.putImageData(result,0,0);mctx.putImageData(maskPixels,0,0);
 return{dataUrl:output.toDataURL('image/png'),mask:finalMask.toDataURL('image/png'),metrics:{changedPixels,protectedChanged,outsideChanged,automaticRegion:true,crop:c,handsDetected:region.handsDetected}};
}
