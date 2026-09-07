const params=new URLSearchParams(location.search);
function decodeList(value){try{const base64=String(value||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value||'').length/4)*4,'='),bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),parsed=JSON.parse(new TextDecoder().decode(bytes));return Array.isArray(parsed)?parsed:[]}catch{return []}}
async function start(){
const payload=params.get('token')&&window.viewerPayload?await window.viewerPayload.get(params.get('token')):{};
const url=payload.url||params.get('url')||'', name=payload.name||params.get('name')||'文件查看', kind=payload.kind||params.get('kind')||'', fileId=payload.fileId||params.get('fileId')||'';
const sources=Array.isArray(payload.sources)?payload.sources:decodeList(params.get('sources')),items=Array.isArray(payload.items)?payload.items:decodeList(params.get('items'));
document.title=name;
const root=document.querySelector('#viewer');
function bindProgress(media){if(!fileId||!window.viewerProgress)return;let restored=false,lastSaved=0;media.addEventListener('loadedmetadata',async()=>{if(restored)return;restored=true;try{const saved=await window.viewerProgress.get(fileId);if(saved?.time>5&&saved.time<media.duration-8)media.currentTime=saved.time}catch{}});media.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved<5000||!Number.isFinite(media.duration))return;lastSaved=Date.now();window.viewerProgress.set({fileId,time:media.currentTime,duration:media.duration})});media.addEventListener('ended',()=>window.viewerProgress.set({fileId,time:0,duration:media.duration}));window.addEventListener('beforeunload',()=>{if(Number.isFinite(media.duration))window.viewerProgress.set({fileId,time:media.currentTime,duration:media.duration})})}
if(kind==='video'){
  const shell=document.createElement('section'),video=document.createElement('video'),toolbar=document.createElement('div'),select=document.createElement('select'),audioSelect=document.createElement('select'),subtitle=document.createElement('button'),capture=document.createElement('button'),status=document.createElement('div');shell.className='video-shell';toolbar.className='video-tools';video.controls=true;video.autoplay=true;video.playsInline=true;bindProgress(video);status.className='viewer-status';select.title='清晰度';audioSelect.title='音轨';audioSelect.hidden=true;subtitle.textContent='字幕';capture.textContent='截图';const choices=sources.length?sources:[{url,label:'默认'}];choices.forEach((source,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=source.label||`线路 ${index+1}`;select.appendChild(option)});if(choices.length<=1)select.hidden=true;let hls=null,current=-1,subtitleUrl='';const fail=()=>{if(current+1<choices.length){select.value=String(current+1);load(current+1)}else status.textContent='所有可用线路均播放失败，请检查登录状态或稍后重试'};const load=index=>{current=index;status.textContent='';audioSelect.hidden=true;audioSelect.replaceChildren();if(hls){hls.destroy();hls=null}video.pause();video.removeAttribute('src');video.load();const source=choices[index]?.url||url,isHls=/\.m3u8(?:[?#]|$)|ts_downloader/i.test(source);if(isHls&&window.Hls?.isSupported()){hls=new window.Hls({enableWorker:true,manifestLoadingMaxRetry:2,fragLoadingMaxRetry:3});hls.loadSource(source);hls.attachMedia(video);hls.on(window.Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED,(_event,data)=>{const tracks=data.audioTracks||[];audioSelect.replaceChildren(...tracks.map((track,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=track.name||track.lang||`音轨 ${index+1}`;return option}));audioSelect.hidden=tracks.length<2});hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(data.fatal)fail()})}else{video.src=source;video.play().catch(()=>{})}};video.addEventListener('error',()=>{if(!hls)fail()});select.addEventListener('change',()=>load(Number(select.value)));audioSelect.addEventListener('change',()=>{if(hls)hls.audioTrack=Number(audioSelect.value)});subtitle.addEventListener('click',async()=>{try{const picked=await window.viewerPayload.chooseSubtitle();if(!picked)return;const text=/^WEBVTT/i.test(picked.text)?picked.text:`WEBVTT\n\n${picked.text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2')}`;if(subtitleUrl)URL.revokeObjectURL(subtitleUrl);subtitleUrl=URL.createObjectURL(new Blob([text],{type:'text/vtt'}));video.querySelectorAll('track[data-local]').forEach(track=>track.remove());const track=document.createElement('track');track.kind='subtitles';track.label=picked.name;track.srclang='zh';track.src=subtitleUrl;track.default=true;track.dataset.local='1';video.append(track);subtitle.textContent=`字幕：${picked.name}`;status.textContent='字幕已加载';setTimeout(()=>status.textContent='',1800)}catch(error){status.textContent=error.message||String(error)}});capture.addEventListener('click',async()=>{try{const rect=video.getBoundingClientRect(),saved=await window.viewerPayload.capture({name,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});if(saved){status.textContent='截图已保存';setTimeout(()=>status.textContent='',1800)}}catch(error){status.textContent=error.message||String(error)}});window.addEventListener('beforeunload',()=>subtitleUrl&&URL.revokeObjectURL(subtitleUrl));toolbar.append(select,audioSelect,subtitle,capture);shell.append(video,toolbar,status);root.replaceChildren(shell);load(0);
}else if(kind==='image'){
  const gallery=items.length?items:[{id:fileId,name,url}],shell=document.createElement('section'),stage=document.createElement('div'),image=document.createElement('img'),previous=document.createElement('button'),next=document.createElement('button'),caption=document.createElement('div'),tools=document.createElement('div'),zoomBadge=document.createElement('span');
  shell.className='image-shell';stage.className='image-stage';tools.className='image-tools';zoomBadge.className='image-zoom-badge';previous.className='image-nav previous';next.className='image-nav next';previous.textContent='‹';next.textContent='›';previous.title='上一张（←）';next.title='下一张（→）';caption.className='image-caption';
  let index=Math.max(0,gallery.findIndex(item=>item.id===fileId||item.url===url)),scale=1,rotation=0,translateX=0,translateY=0,timer=null,isDragging=false,startX=0,startY=0,origX=0,origY=0;
  const button=(text,title,action)=>{const value=document.createElement('button');value.textContent=text;value.title=title;value.addEventListener('click',action);tools.append(value);return value};
  const applyTransform=()=>{
    image.style.transform=`translate(${translateX}px, ${translateY}px) scale(${scale}) rotate(${rotation}deg)`;
    zoomBadge.textContent=`${Math.round(scale*100)}%`;
  };
  const fit=()=>{scale=1;rotation=0;translateX=0;translateY=0;applyTransform()};
  const actualSize=()=>{
    translateX=0;translateY=0;
    if(image.naturalWidth&&image.clientWidth){scale=Math.max(0.2,Math.min(8,Math.round((image.naturalWidth/image.clientWidth)*100)/100))}
    else scale=1;
    applyTransform();
  };
  const zoom=amount=>{
    scale=Math.max(0.1,Math.min(8,Math.round((scale+amount)*10)/10));
    if(scale===1){translateX=0;translateY=0}
    applyTransform();
  };
  const show=value=>{
    index=Math.max(0,Math.min(gallery.length-1,value));const item=gallery[index];
    fit();image.src=item.url;image.alt=item.name;document.title=item.name;
    caption.textContent=`${index+1} / ${gallery.length}  ${item.name}`;
    previous.disabled=index===0;next.disabled=index===gallery.length-1;
  };
  const slide=button('▶','开始幻灯片（空格）',()=>{
    if(timer){clearInterval(timer);timer=null;slide.textContent='▶';slide.title='开始幻灯片（空格）'}
    else{timer=setInterval(()=>show(index+1<gallery.length?index+1:0),3000);slide.textContent='⏸';slide.title='暂停幻灯片（空格）'}
  });
  button('−','缩小（-）',()=>zoom(-.2));
  tools.append(zoomBadge);
  button('＋','放大（+）',()=>zoom(.2));
  button('1:1','实际大小（1）',actualSize);
  button('适应','恢复并适应窗口（0）',fit);
  button('↺','逆时针旋转（L）',()=>{rotation=(rotation+270)%360;applyTransform()});
  button('↻','顺时针旋转（R）',()=>{rotation=(rotation+90)%360;applyTransform()});

  stage.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    isDragging=true;startX=e.clientX;startY=e.clientY;origX=translateX;origY=translateY;
    stage.classList.add('dragging');
  });
  window.addEventListener('mousemove',e=>{
    if(!isDragging)return;
    translateX=origX+(e.clientX-startX);
    translateY=origY+(e.clientY-startY);
    applyTransform();
  });
  window.addEventListener('mouseup',()=>{
    if(!isDragging)return;
    isDragging=false;stage.classList.remove('dragging');
  });
  image.addEventListener('dblclick',e=>{
    e.preventDefault();
    if(scale!==1)fit();
    else zoom(1.0);
  });
  previous.addEventListener('click',()=>show(index-1));
  next.addEventListener('click',()=>show(index+1));
  shell.addEventListener('wheel',event=>{
    event.preventDefault();
    zoom(event.deltaY<0?.2:-.2);
  },{passive:false});
  document.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft')show(index-1);
    else if(event.key==='ArrowRight')show(index+1);
    else if(event.key==='+'||event.key==='=')zoom(.2);
    else if(event.key==='-')zoom(-.2);
    else if(event.key==='0')fit();
    else if(event.key==='1')actualSize();
    else if(event.key.toLowerCase()==='r'){rotation=(rotation+90)%360;applyTransform()}
    else if(event.key.toLowerCase()==='l'){rotation=(rotation+270)%360;applyTransform()}
    else if(event.key===' '){event.preventDefault();slide.click()}
  });
  image.addEventListener('error',()=>{caption.textContent='图片打开失败，请检查登录状态或链接是否已过期'});
  image.addEventListener('load',()=>{fit()});
  window.addEventListener('beforeunload',()=>timer&&clearInterval(timer));
  stage.append(image);shell.append(stage,tools,previous,next,caption);root.replaceChildren(shell);show(index);
}else{
  const element=kind==='audio'?document.createElement('audio'):kind==='pdf'||kind==='text'?document.createElement('iframe'):null;
  if(!element){root.innerHTML='<div class="error">此文件类型暂不支持预览</div>'}else{if(element instanceof HTMLMediaElement){element.controls=true;element.autoplay=true;bindProgress(element)}element.src=url;element.title=name;element.addEventListener('error',()=>{root.innerHTML='<div class="error">文件打开失败，请检查登录状态或链接是否已过期</div>'});root.replaceChildren(element)}
}
}
start().catch(error=>{const root=document.querySelector('#viewer'),message=document.createElement('div');message.className='error';message.textContent=String(error?.message||error||'文件打开失败');if(root)root.replaceChildren(message)});
