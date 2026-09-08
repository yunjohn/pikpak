const params=new URLSearchParams(location.search);
function decodeList(value){try{const base64=String(value||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(value||'').length/4)*4,'='),bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),parsed=JSON.parse(new TextDecoder().decode(bytes));return Array.isArray(parsed)?parsed:[]}catch{return []}}
async function start(){
const payload=params.get('token')&&window.viewerPayload?await window.viewerPayload.get(params.get('token')):{};
const url=payload.url||params.get('url')||'', name=payload.name||params.get('name')||'文件查看', kind=payload.kind||params.get('kind')||'', fileId=payload.fileId||params.get('fileId')||'';
let sources=Array.isArray(payload.sources)?payload.sources:decodeList(params.get('sources'));const items=Array.isArray(payload.items)?payload.items:decodeList(params.get('items')),subtitles=Array.isArray(payload.subtitles)?payload.subtitles:decodeList(params.get('subtitles')),playlist=Array.isArray(payload.playlist)?payload.playlist:[];
document.title=name;
const root=document.querySelector('#viewer');
let currentFileId=fileId,currentName=name,currentUrl=url;
function formatVttTime(totalSeconds){const totalMs=Math.max(0,Math.round(totalSeconds*1000)),ms=totalMs%1000,totalS=Math.floor(totalMs/1000),s=totalS%60,totalM=Math.floor(totalS/60),m=totalM%60,h=Math.floor(totalM/60);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`}
function parseTime(str){const parts=str.trim().replace(',','.').split(':');if(parts.length===3){const h=parseFloat(parts[0])||0,m=parseFloat(parts[1])||0,s=parseFloat(parts[2])||0;return h*3600+m*60+s}return 0}
function assToVtt(assText){const lines=assText.split(/\r?\n/),cues=[];for(const line of lines){if(/^Dialogue:\s*/i.test(line)){const parts=line.replace(/^Dialogue:\s*/i,'').split(',');if(parts.length>=10){const start=parseTime(parts[1]),end=parseTime(parts[2]),text=parts.slice(9).join(',').replace(/\{[^}]+\}/g,'').replace(/\\N/g,'\n').trim();if(text)cues.push({start,end,text})}}}let vtt='WEBVTT\n\n';cues.forEach((cue,i)=>{vtt+=`${i+1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}\n\n`});return vtt}
function convertToVtt(rawText,delaySeconds=0){let vtt=rawText;if(/^\[Script Info\]/i.test(rawText)||/\[Events\]/i.test(rawText)||rawText.includes('Dialogue:'))vtt=assToVtt(rawText);else if(!/^WEBVTT/i.test(rawText))vtt=`WEBVTT\n\n${rawText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,'$1.$2')}`;if(delaySeconds!==0){vtt=vtt.replace(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/g,(_,start,end)=>{const s=Math.max(0,parseTime(start)+delaySeconds),e=Math.max(0,parseTime(end)+delaySeconds);return `${formatVttTime(s)} --> ${formatVttTime(e)}`})}return vtt}
function bindProgress(media){if(!currentFileId||!window.viewerProgress)return;let restoredFor='',lastSaved=0;media.addEventListener('loadedmetadata',async()=>{const targetId=currentFileId;if(!targetId||restoredFor===targetId)return;restoredFor=targetId;try{const saved=await window.viewerProgress.get(targetId);if(targetId===currentFileId&&saved?.time>5&&saved.time<media.duration-8)media.currentTime=saved.time}catch{}});media.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved<5000||!Number.isFinite(media.duration)||!currentFileId)return;lastSaved=Date.now();window.viewerProgress.set({fileId:currentFileId,time:media.currentTime,duration:media.duration})});media.addEventListener('ended',()=>{if(currentFileId)window.viewerProgress.set({fileId:currentFileId,time:0,duration:media.duration})});window.addEventListener('beforeunload',()=>{if(currentFileId&&Number.isFinite(media.duration))window.viewerProgress.set({fileId:currentFileId,time:media.currentTime,duration:media.duration})})}
if(kind==='video'){
  const shell=document.createElement('section'),video=document.createElement('video'),toolbar=document.createElement('div'),select=document.createElement('select'),speedSelect=document.createElement('select'),audioSelect=document.createElement('select'),subSelect=document.createElement('select'),previousVideo=document.createElement('button'),nextVideo=document.createElement('button'),autoNext=document.createElement('button'),subtitle=document.createElement('button'),pip=document.createElement('button'),external=document.createElement('button'),capture=document.createElement('button'),status=document.createElement('div');
  const preferenceKey='pikpak-viewer-video-preferences-v1';
  const readPreferences=()=>{try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'{}');return {rate:[.5,.75,1,1.25,1.5,2].includes(Number(value.rate))?Number(value.rate):1,volume:Number.isFinite(Number(value.volume))?Math.max(0,Math.min(1,Number(value.volume))):1,muted:Boolean(value.muted)}}catch{return {rate:1,volume:1,muted:false}}};
  const preferences=readPreferences(),savePreferences=()=>{try{localStorage.setItem(preferenceKey,JSON.stringify({rate:video.playbackRate,volume:video.volume,muted:video.muted,autoNext:autoNext.dataset.enabled==='1'}))}catch{}};
  const savedAutoNext=(()=>{try{return JSON.parse(localStorage.getItem(preferenceKey)||'{}').autoNext===true}catch{return false}})();
  shell.className='video-shell';toolbar.className='video-tools';video.controls=true;video.autoplay=true;video.playsInline=true;video.volume=preferences.volume;video.muted=preferences.muted;video.playbackRate=preferences.rate;video.style.objectFit='contain';bindProgress(video);status.className='viewer-status';select.title='清晰度';speedSelect.title='播放速度';audioSelect.title='音轨';audioSelect.hidden=true;subSelect.title='在线字幕';subSelect.hidden=!subtitles.length;previousVideo.textContent='上一集';previousVideo.title='上一集（PageUp）';nextVideo.textContent='下一集';nextVideo.title='下一集（PageDown）';autoNext.dataset.enabled=savedAutoNext?'1':'0';autoNext.textContent=savedAutoNext?'自动连播：开':'自动连播：关';autoNext.title='播放结束后自动播放下一集';subtitle.textContent='字幕';pip.textContent='画中画';pip.title='画中画（P）';external.textContent='外部播放器';external.title='使用设置中选择的本机播放器打开';capture.textContent='截图';let choices=sources.length?sources:[{url,label:'默认'}];const renderChoices=()=>{select.replaceChildren(...choices.map((source,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=source.label||`线路 ${index+1}`;return option}));select.hidden=choices.length<=1};renderChoices();[.5,.75,1,1.25,1.5,2].forEach(rate=>{const option=document.createElement('option');option.value=String(rate);option.textContent=`${rate}×`;if(rate===preferences.rate)option.selected=true;speedSelect.appendChild(option)});
  if(subtitles.length){const defOpt=document.createElement('option');defOpt.value='';defOpt.textContent=`在线字幕 (${subtitles.length})`;subSelect.appendChild(defOpt);subtitles.forEach((s,index)=>{const opt=document.createElement('option');opt.value=String(index);opt.textContent=s.name;subSelect.appendChild(opt)});const localOpt=document.createElement('option');localOpt.value='__local__';localOpt.textContent='从本地选择字幕…';subSelect.appendChild(localOpt)}
  let hls=null,current=-1,subtitleUrl='',currentSubRaw='',currentSubName='',currentSubDelay=0,delayGroup=null;
  const ensureDelayTools=()=>{
    if(delayGroup)return;
    delayGroup=document.createElement('span');delayGroup.className='subtitle-delay-tools';
    const minus=document.createElement('button');minus.textContent='-0.5s';minus.title='字幕提前 0.5 秒';minus.addEventListener('click',()=>{if(!currentSubRaw)return;currentSubDelay=Math.round((currentSubDelay-0.5)*10)/10;applySub(currentSubName,currentSubRaw,currentSubDelay);status.textContent=`字幕延迟: ${currentSubDelay>0?'+':''}${currentSubDelay.toFixed(1)}s`;setTimeout(()=>status.textContent='',1800)});
    const plus=document.createElement('button');plus.textContent='+0.5s';plus.title='字幕延后 0.5 秒';plus.addEventListener('click',()=>{if(!currentSubRaw)return;currentSubDelay=Math.round((currentSubDelay+0.5)*10)/10;applySub(currentSubName,currentSubRaw,currentSubDelay);status.textContent=`字幕延迟: ${currentSubDelay>0?'+':''}${currentSubDelay.toFixed(1)}s`;setTimeout(()=>status.textContent='',1800)});
    const reset=document.createElement('button');reset.textContent='重置 0s';reset.title='重置字幕延迟';reset.addEventListener('click',()=>{if(!currentSubRaw)return;currentSubDelay=0;applySub(currentSubName,currentSubRaw,0);status.textContent='字幕延迟已重置';setTimeout(()=>status.textContent='',1800)});
    delayGroup.append(minus,plus,reset);toolbar.append(delayGroup);
  };
  const applySub=(name,rawText,delay=0)=>{
    currentSubName=name;currentSubRaw=rawText;currentSubDelay=delay;
    const vtt=convertToVtt(rawText,delay);
    if(subtitleUrl)URL.revokeObjectURL(subtitleUrl);
    subtitleUrl=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));
    video.querySelectorAll('track[data-local]').forEach(track=>track.remove());
    const track=document.createElement('track');track.kind='subtitles';track.label=name;track.srclang='zh';track.src=subtitleUrl;track.default=true;track.dataset.local='1';video.append(track);
    subtitle.textContent=`字幕：${name}${delay?` (${delay>0?'+':''}${delay.toFixed(1)}s)`:''}`;
    ensureDelayTools();
  };
  let loadGeneration=0,refreshedMedia=false;
  const showStatus=(message,isError=false)=>{status.textContent=message;status.classList.toggle('error-status',isError);if(message&&!isError)setTimeout(()=>{if(status.textContent===message)status.textContent=''},1800)};
  const mediaFailureMessage=()=>{const code=Number(video.error?.code||0);if(code===3)return'当前视频或音轨编码无法由内置播放器解码';if(code===4)return'当前封装或编码不受内置播放器支持';if(code===2)return'媒体网络请求失败';return'所有可用线路均播放失败'};
  const fail=async generation=>{if(generation!==loadGeneration)return;if(current+1<choices.length){showStatus(`当前线路失败，正在切换到 ${choices[current+1]?.label||'备用线路'}…`);select.value=String(current+1);load(current+1,true);return}if(!refreshedMedia&&window.viewerPayload?.refreshMedia){refreshedMedia=true;try{showStatus('播放地址可能已过期，正在刷新…');const fresh=await window.viewerPayload.refreshMedia(currentFileId);if(generation!==loadGeneration)return;const next=Array.isArray(fresh?.sources)?fresh.sources:[];if(next.length){choices=next;currentUrl=fresh.url||next[0].url;renderChoices();select.value='0';load(0,true);return}}catch(error){showStatus(error.message||String(error),true)}}showStatus(`${mediaFailureMessage()}；可尝试“外部播放器”或稍后重试`,true)};
  const load=(index,preserve=false)=>{const generation=++loadGeneration,snapshot=preserve?{time:Number(video.currentTime)||0,paused:video.paused,volume:video.volume,muted:video.muted,rate:video.playbackRate}:{time:0,paused:false,volume:video.volume,muted:video.muted,rate:Number(speedSelect.value)||1};current=index;showStatus(preserve?'正在切换清晰度…':'正在加载视频…');audioSelect.hidden=true;audioSelect.replaceChildren();if(hls){hls.destroy();hls=null}video.pause();video.removeAttribute('src');video.load();const restore=()=>{if(generation!==loadGeneration)return;if(snapshot.time>0&&Number.isFinite(video.duration))video.currentTime=Math.min(snapshot.time,Math.max(0,video.duration-.1));video.volume=snapshot.volume;video.muted=snapshot.muted;video.playbackRate=snapshot.rate;speedSelect.value=String(snapshot.rate);if(!snapshot.paused)video.play().catch(()=>{});showStatus(preserve?'清晰度已切换':'')};video.addEventListener('loadedmetadata',restore,{once:true});const source=choices[index]?.url||currentUrl,isHls=/\.m3u8(?:[?#]|$)|ts_downloader/i.test(source);if(isHls&&window.Hls?.isSupported()){let networkRecoveries=0,mediaRecoveries=0;const activeHls=hls=new window.Hls({enableWorker:true,manifestLoadingMaxRetry:2,fragLoadingMaxRetry:3});activeHls.loadSource(source);activeHls.attachMedia(video);activeHls.on(window.Hls.Events.MANIFEST_PARSED,()=>{if(generation===loadGeneration&&!preserve)video.play().catch(()=>{showStatus('点击播放按钮开始播放')})});activeHls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED,(_event,data)=>{if(generation!==loadGeneration)return;const tracks=data.audioTracks||[];audioSelect.replaceChildren(...tracks.map((track,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=track.name||track.lang||`音轨 ${index+1}`;return option}));audioSelect.hidden=tracks.length<2});activeHls.on(window.Hls.Events.ERROR,(_event,data)=>{if(!data.fatal||generation!==loadGeneration)return;if(data.type===window.Hls.ErrorTypes.NETWORK_ERROR&&networkRecoveries++<2){showStatus('网络波动，正在恢复播放…');activeHls.startLoad();return}if(data.type===window.Hls.ErrorTypes.MEDIA_ERROR&&mediaRecoveries++<2){showStatus('解码异常，正在恢复播放…');activeHls.recoverMediaError();return}fail(generation)})}else{video.src=source;if(!preserve)video.play().catch(()=>{showStatus('点击播放按钮开始播放')})}};video.addEventListener('error',()=>{if(!hls)fail(loadGeneration)});select.addEventListener('change',()=>load(Number(select.value),true));speedSelect.addEventListener('change',()=>{video.playbackRate=Number(speedSelect.value)||1;savePreferences();showStatus(`播放速度 ${speedSelect.value}×`)});video.addEventListener('volumechange',savePreferences);video.addEventListener('ratechange',savePreferences);audioSelect.addEventListener('change',()=>{if(hls)hls.audioTrack=Number(audioSelect.value)});
  let playlistIndex=Math.max(0,playlist.findIndex(item=>item.fileId===currentFileId)),switchingEpisode=false;
  const updateEpisodeButtons=()=>{const enabled=playlist.length>1;previousVideo.hidden=!enabled;nextVideo.hidden=!enabled;autoNext.hidden=!enabled;previousVideo.disabled=!enabled||playlistIndex<=0;nextVideo.disabled=!enabled||playlistIndex>=playlist.length-1};
  const switchEpisode=async targetIndex=>{if(switchingEpisode||targetIndex<0||targetIndex>=playlist.length||targetIndex===playlistIndex)return;switchingEpisode=true;previousVideo.disabled=true;nextVideo.disabled=true;try{if(currentFileId&&Number.isFinite(video.duration))await window.viewerProgress?.set({fileId:currentFileId,time:video.currentTime,duration:video.duration});const target=playlist[targetIndex];showStatus(`正在加载：${target.name}…`);let resolved={url:target.url,sources:target.sources};if(!Array.isArray(resolved.sources)||!resolved.sources.length)resolved=await window.viewerPayload.resolveMedia(target.fileId);currentFileId=target.fileId;currentName=target.name;currentUrl=resolved.url||resolved.sources?.[0]?.url||'';choices=Array.isArray(resolved.sources)&&resolved.sources.length?resolved.sources:[{url:currentUrl,label:'默认'}];playlistIndex=targetIndex;refreshedMedia=false;document.title=currentName;renderChoices();select.value='0';if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl=''}video.querySelectorAll('track[data-local]').forEach(track=>track.remove());currentSubRaw='';currentSubName='';currentSubDelay=0;subtitle.textContent='字幕';subSelect.replaceChildren();subSelect.hidden=true;load(0,false)}catch(error){showStatus(error.message||String(error),true)}finally{switchingEpisode=false;updateEpisodeButtons()}};
  previousVideo.addEventListener('click',()=>switchEpisode(playlistIndex-1));nextVideo.addEventListener('click',()=>switchEpisode(playlistIndex+1));autoNext.addEventListener('click',()=>{const enabled=autoNext.dataset.enabled!=='1';autoNext.dataset.enabled=enabled?'1':'0';autoNext.textContent=enabled?'自动连播：开':'自动连播：关';savePreferences()});updateEpisodeButtons();
  subSelect.addEventListener('change',async()=>{
    if(subSelect.value==='__local__'){subtitle.click();return}
    const idx=Number(subSelect.value);if(isNaN(idx)||!subtitles[idx])return;
    try{status.textContent=`正在加载字幕 ${subtitles[idx].name}…`;const res=await fetch(subtitles[idx].url);if(!res.ok)throw new Error(`HTTP ${res.status}`);const bytes=await res.arrayBuffer();const text=window.viewerPayload?.decodeSubtitle?await window.viewerPayload.decodeSubtitle(bytes):new TextDecoder().decode(bytes);applySub(subtitles[idx].name,text,0);status.textContent='字幕已加载';setTimeout(()=>status.textContent='',1800)}catch(error){status.textContent=error.message||String(error)}
  });
  subtitle.addEventListener('click',async()=>{try{const picked=await window.viewerPayload.chooseSubtitle();if(!picked)return;applySub(picked.name,picked.text,0);status.textContent='字幕已加载';setTimeout(()=>status.textContent='',1800)}catch(error){status.textContent=error.message||String(error)}});
  pip.addEventListener('click',async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(video.requestPictureInPicture)await video.requestPictureInPicture();else throw new Error('当前系统不支持画中画')}catch(error){showStatus(error.message||String(error),true)}});
  external.addEventListener('click',async()=>{try{await window.viewerPayload.openExternal(currentFileId);showStatus('已在外部播放器中打开')}catch(error){showStatus(error.message||String(error),true)}});
  capture.addEventListener('click',async()=>{try{const rect=video.getBoundingClientRect(),saved=await window.viewerPayload.capture({name:currentName,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});if(saved){status.textContent='截图已保存';setTimeout(()=>status.textContent='',1800)}}catch(error){status.textContent=error.message||String(error)}});
  let controlsTimer=null;
  const showControls=()=>{shell.classList.remove('controls-hidden');clearTimeout(controlsTimer);if(!video.paused)controlsTimer=setTimeout(()=>shell.classList.add('controls-hidden'),2600)};
  const toggleFullscreen=()=>document.fullscreenElement?document.exitFullscreen?.():shell.requestFullscreen?.();
  shell.addEventListener('mousemove',showControls);shell.addEventListener('mouseleave',()=>{if(!video.paused)shell.classList.add('controls-hidden')});toolbar.addEventListener('mouseenter',()=>clearTimeout(controlsTimer));toolbar.addEventListener('mouseleave',showControls);video.addEventListener('dblclick',toggleFullscreen);
  video.addEventListener('playing',()=>{showStatus('');showControls();window.viewerPlayback?.setPlaying(true)});video.addEventListener('pause',()=>{clearTimeout(controlsTimer);shell.classList.remove('controls-hidden');window.viewerPlayback?.setPlaying(false)});video.addEventListener('ended',()=>{clearTimeout(controlsTimer);shell.classList.remove('controls-hidden');window.viewerPlayback?.setPlaying(false);if(autoNext.dataset.enabled==='1'&&playlistIndex<playlist.length-1)switchEpisode(playlistIndex+1)});video.addEventListener('waiting',()=>{showControls();showStatus('正在缓冲…')});video.addEventListener('stalled',()=>{showControls();showStatus('网络较慢，正在等待数据…')});
  window.addEventListener('beforeunload',()=>{clearTimeout(controlsTimer);window.viewerPlayback?.setPlaying(false);if(subtitleUrl)URL.revokeObjectURL(subtitleUrl)});
  document.addEventListener('keydown',event=>{if(event.target?.matches?.('select,input,button'))return;let message='';if(event.key===' '){event.preventDefault();if(video.paused){video.play().catch(()=>{});message='播放'}else{video.pause();message='暂停'}}else if(event.key==='ArrowLeft'){event.preventDefault();video.currentTime=Math.max(0,(video.currentTime||0)-5);message='后退 5 秒'}else if(event.key==='ArrowRight'){event.preventDefault();video.currentTime=Math.min(Number.isFinite(video.duration)?video.duration:(video.currentTime||0)+5,(video.currentTime||0)+5);message='前进 5 秒'}else if(event.key==='ArrowUp'){event.preventDefault();video.volume=Math.min(1,video.volume+.05);message=`音量 ${Math.round(video.volume*100)}%`}else if(event.key==='ArrowDown'){event.preventDefault();video.volume=Math.max(0,video.volume-.05);message=`音量 ${Math.round(video.volume*100)}%`}else if(event.key==='PageUp'){event.preventDefault();previousVideo.click()}else if(event.key==='PageDown'){event.preventDefault();nextVideo.click()}else if(event.key.toLowerCase()==='m'){video.muted=!video.muted;message=video.muted?'静音':'取消静音'}else if(event.key.toLowerCase()==='p'){pip.click();message='切换画中画'}else if(event.key.toLowerCase()==='f'){toggleFullscreen();message=document.fullscreenElement?'退出全屏':'全屏'}if(message){showControls();showStatus(message)}});
  toolbar.append(previousVideo,nextVideo,autoNext,select,speedSelect,audioSelect,subSelect,subtitle,pip,external,capture);shell.append(video,toolbar,status);root.replaceChildren(shell);load(0);
  if(subtitles.length&&subtitles[0]?.url){const subtitleFileId=currentFileId;fetch(subtitles[0].url).then(r=>r.ok?r.arrayBuffer():Promise.reject(new Error(`HTTP ${r.status}`))).then(bytes=>window.viewerPayload?.decodeSubtitle?window.viewerPayload.decodeSubtitle(bytes):new TextDecoder().decode(bytes)).then(text=>{if(currentFileId!==subtitleFileId)return;applySub(subtitles[0].name,text,0);subSelect.value='0'}).catch(()=>{})}
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
