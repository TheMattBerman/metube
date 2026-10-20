export function selectFace(faceLandmarks,w,h){
  const faces=faceLandmarks.map((points,index)=>{
   const ovalIndices=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
   const oval=ovalIndices.map(i=>({x:points[i].x*w,y:points[i].y*h}));
   const xs=oval.map(p=>p.x),ys=oval.map(p=>p.y);
   const box={x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
   box.width=box.right-box.x;box.height=box.bottom-box.y;
   const anchors=[33,263,1,13,152].map(i=>points[i]);
   const complete=anchors.every(p=>p.x>.005&&p.x<.995&&p.y>.005&&p.y<.995)&&oval.filter(p=>p.x>=0&&p.x<w&&p.y>=0&&p.y<h).length/oval.length>.95;
   return{index,box,oval,complete,area:box.width*box.height};
  });
  const selected=faces.filter(f=>f.complete&&f.box.width>=64&&f.box.height>=64).sort((a,b)=>b.area-a.area)[0];

return {faces,selected};
}
