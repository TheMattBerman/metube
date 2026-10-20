// The view switch only changes local image sources. It never submits a generation.
class MeTubeComparison {
  constructor({videoIdFromSrc,onChange=()=>{}}){this.videoIdFromSrc=videoIdFromSrc;this.onChange=onChange;this.mode='after';this.entries=new Map();}
  record(img,videoId,dataUrl){
    let item=this.entries.get(img);
    if(item&&item.videoId!==videoId){this.release(img);item=null;}
    if(!item){
      item={videoId,src:this.videoIdFromSrc(img.src)===videoId?img.src:(this.videoIdFromSrc(img.currentSrc)===videoId?img.currentSrc:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),srcset:img.srcset,after:dataUrl};
      item.observer=new MutationObserver(()=>{
        const current=this.videoIdFromSrc(img.srcset)||this.videoIdFromSrc(img.src);
        if(!img.isConnected||(current&&current!==item.videoId)){this.release(img);return;}
        this.paint(img,item);
      });
      this.entries.set(img,item);item.observer.observe(img,{attributes:true,attributeFilter:['src','srcset']});
    }else item.after=dataUrl;
    this.paint(img,item);this.onChange(this.mode);
  }
  paint(img,item){
    const after=this.mode==='after',src=after?item.after:item.src,srcset=after?'':item.srcset;
    if(img.srcset!==srcset)img.srcset=srcset;
    if(img.src!==src)img.src=src;
    img.dataset.metubeVid=item.videoId;img.classList.toggle('metube-done',after);
  }
  show(mode){
    if(!['before','after'].includes(mode))return;
    this.mode=mode;
    for(const[img,item]of this.entries){const current=this.videoIdFromSrc(img.srcset)||this.videoIdFromSrc(img.src);if(!img.isConnected||(current&&current!==item.videoId))this.release(img);else this.paint(img,item);}
    this.onChange(mode);
  }
  release(img){const item=this.entries.get(img);item?.observer.disconnect();this.entries.delete(img);delete img.dataset.metubeVid;img.classList.remove('metube-done');}
  sweep(){for(const[img]of this.entries)if(!img.isConnected)this.release(img);}
  clear(){for(const[img,item]of this.entries){item.observer.disconnect();const current=this.videoIdFromSrc(img.srcset)||this.videoIdFromSrc(img.src);if(img.isConnected&&(!current||current===item.videoId)){img.src=item.src;img.srcset=item.srcset;}delete img.dataset.metubeVid;img.classList.remove('metube-done');}this.entries.clear();this.mode='after';this.onChange(this.mode);}
}
