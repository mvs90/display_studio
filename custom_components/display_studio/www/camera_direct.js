/* Incremental MSE playback of the ESP's original H.264 samples through HA.
 * No second encoder connection, remuxing, image conversion or saved pixels.
 */
const MAX_BOX=2*1024*1024;
const join=(a,b)=>{const out=new Uint8Array(a.length+b.length);out.set(a);out.set(b,a.length);return out;};
const kind=data=>String.fromCharCode(...data.subarray(4,8));

export function mp4Codec(data) {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const scan=(start,end,depth)=>{
    if(depth>8)throw Error('MP4 nesting');
    while(start<end){
      if(start+8>end)throw Error('MP4 header');
      const size=view.getUint32(start),type=kind(data.subarray(start));
      if(size<8 || start+size>end)throw Error('MP4 size');
      if(type==='avcC' && size>=12 && data[start+8]===1)return 'avc1.'+[...data.subarray(start+9,start+12)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const offset={moov:8,trak:8,mdia:8,minf:8,stbl:8,stsd:16,avc1:86}[type];
      if(offset){const codec=scan(start+offset,start+size,depth+1);if(codec)return codec;}
      start+=size;
    }
  };
  const codec=scan(0,data.length,0);if(!codec)throw Error('Missing H264 codec');return codec;
}

export async function* mp4Boxes(reader) {
  let pending=new Uint8Array();
  while(true){
    const {value,done}=await reader.read();
    if(done){if(pending.length)throw Error('Truncated MP4');return;}
    if(pending.length+value.length>6*1024*1024)throw Error('MP4 buffer exceeded');
    pending=join(pending,value);
    while(pending.length>=8){
      const size=new DataView(pending.buffer,pending.byteOffset,4).getUint32(0);
      if(size<8 || size>MAX_BOX)throw Error('Invalid MP4 box');
      if(pending.length<size)break;
      yield pending.subarray(0,size);pending=pending.slice(size);
    }
  }
}

function event(target,name,signal,action) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{target.removeEventListener(name,done);target.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);};
    const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(Error('MediaSource error'));};
    const aborted=()=>{cleanup();reject(new DOMException('Closed','AbortError'));};
    target.addEventListener(name,done);target.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted){aborted();return;}
    try{action?.();}catch(error){cleanup();reject(error);}
  });
}

export class DirectCamera {
  constructor(video,hass,path) {this.video=video;this.hass=hass;this.path=path;this.controller=new AbortController();this.closed=false;this.started=false;}
  async run() {
    const signal=this.controller.signal;
    const response=await this.hass.fetchWithAuth(this.path,{signal,cache:'no-store'});
    if(!response.ok || !response.body)throw Error('Direct camera unavailable');
    this.reader=response.body.getReader();const packets=mp4Boxes(this.reader);
    const first=await packets.next(),second=await packets.next();
    if(first.done || second.done || kind(first.value)!=='ftyp' || kind(second.value)!=='moov')throw Error('Invalid camera initialization');
    const mime=`video/mp4; codecs="${mp4Codec(second.value)}"`;
    if(!MediaSource.isTypeSupported(mime))throw Error('Camera codec unsupported');
    this.source=new MediaSource();this.url=URL.createObjectURL(this.source);
    await event(this.source,'sourceopen',signal,()=>{this.video.src=this.url;});
    this.buffer=this.source.addSourceBuffer(mime);
    await this.append(join(first.value,second.value));
    for await(const moof of packets){
      const mdat=await packets.next();
      if(kind(moof)!=='moof' || mdat.done || kind(mdat.value)!=='mdat')throw Error('Invalid camera fragment');
      await this.append(join(moof,mdat.value));
      this.followLive();
      const ranges=this.buffer.buffered,cut=this.video.currentTime-3;
      if(ranges.length && cut>ranges.start(0)+1)await event(this.buffer,'updateend',signal,()=>this.buffer.remove(0,cut));
    }
    throw Error('Camera disconnected');
  }
  append(data){return event(this.buffer,'updateend',this.controller.signal,()=>this.buffer.appendBuffer(data));}
  followLive() {
    const video=this.video,ranges=video.buffered;if(!ranges.length)return;
    const start=ranges.start(ranges.length-1),end=ranges.end(ranges.length-1),ahead=end-video.currentTime;
    if(end-start<.25)return;
    if(!this.started || video.currentTime<start || ahead>.65){video.currentTime=Math.max(start,end-.25);this.started=true;}
    video.playbackRate=ahead>.4?1.08:1;
    if(video.paused)video.play().catch(()=>{});
  }
  close(){
    this.closed=true;this.controller.abort();void this.reader?.cancel().catch(()=>{});
    if(this.url)URL.revokeObjectURL(this.url);this.url=null;
  }
}
