<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import FolderTree from './FolderTree.vue';

const api = window.pikpak || {
  getAccount: async()=>({connected:false}), getAccountAbout:async()=>({quota:null}), onAccountExpired:()=>()=>{}, setAccessToken:async token=>({connected:!!token}), login:async()=>({connected:false}), logout:async()=>({connected:false}),
  listDrive:async()=>({files:demoFiles}), searchDrive:async()=>({files:[],scanned:0,folders:0}), cancelSearch:async()=>true, onSearchProgress:()=>()=>{}, getDriveFile:async()=>({}), listStarred:async()=>({files:[]}), listRecent:async()=>({files:[]}), listMyShares:async()=>({files:[]}), copyShare:async()=>'', cancelShares:async()=>({}), setStarred:async()=>({}), openShare:async()=>({share:{shareId:'demo'},files:demoFiles}),
  getShareFile:async()=>({}), restoreShare:async()=>({}), createShare:async()=>({shareUrl:'https://mypikpak.com/s/demo',passCode:'1234'}), createOfflineTask:async()=>({}), listOfflineTasks:async()=>({tasks:[]}), deleteOfflineTask:async()=>({}), createFolder:async()=>({}), rename:async()=>({}), trash:async()=>({}), transfer:async()=>({}), listTrash:async()=>({files:[]}), restoreTrash:async()=>({}), deleteTrash:async()=>({}), startDownload:async payload=>({id:'demo',name:payload.name,state:'queued'}), openViewer:async()=>true, listArchive:async()=>({items:[]}), chooseUpload:async()=>[], chooseUploadFolder:async()=>[], uploadDroppedFiles:async()=>[], cancelUpload:async()=>false, retryUpload:async()=>({}), listUploads:async()=>[], removeUpload:async()=>[], clearUploads:async()=>[], getSettings:async()=>({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3}),  chooseDownloadDirectory:async()=>'', saveSettings:async value=>value, resetSettings:async()=>({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3}), exportDiagnostics:async()=>({}), clearAppCache:async()=>true, onUpload:()=>()=>{}, cancelDownload:async()=>true, retryDownload:async()=>({}), showDownload:async()=>true, listDownloads:async()=>[], removeDownload:async()=>[], clearDownloads:async()=>[], onDownload:()=>()=>{}
};
const demoFiles = [
  {id:'demo-folder',kind:'drive#folder',name:'示例目录',modified_time:new Date().toISOString()},
  {id:'demo-video',kind:'drive#file',name:'欢迎使用 PikPak Desktop.mp4',size:'128849018',mime_type:'video/mp4'}
];
const mode=ref('drive'), files=ref([]), selected=ref(null), selectedIds=ref([]), loading=ref(false), error=ref(''), notice=ref('');
const shareUrl=ref(''), share=ref(null), account=ref({connected:false}), quota=ref(null), token=ref('');
const downloads=ref([]);
const settings=ref({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3});
const uploads=ref([]);
const offlineTasks=ref([]), offlineUrl=ref('');
const thumbFailed=ref({});
const dragUpload=ref(false);
const archive=ref({open:false,name:'',items:[],path:'',nodes:[],password:'',loading:false,error:'',request:null});
const shareSaveDialog=ref({open:false,targetId:'',targetName:'根目录',folders:[],loading:false,path:[{id:'',name:'根目录'}]});
const conflictDialog=ref({open:false,operation:'copy',conflicts:[],nonConflicts:[],targetId:'',targetName:'',loading:false});
const batchResultModal=ref({open:false,title:'批量操作完成',operation:'',successCount:0,skipCount:0,failCount:0,details:[]});
const query=ref(''), sortBy=ref('name'), sortDirection=ref(1);
const globalQuery=ref(''),searchStats=ref(null),searchLive=ref({scanned:0,folders:0,matchesCount:0,isDone:true});
const clipboard=ref(null);
const pathStack=ref([{id:'',name:'全部文件'}]);
const treeChildren=ref({}), treeExpanded=ref([]);
const NAV_STATE_KEY='pikpak-desktop-navigation-v1';
const folders=computed(()=>files.value.filter(item=>item.kind==='drive#folder'));
const selectedItems=computed(()=>files.value.filter(item=>selectedIds.value.includes(item.id)));
const visibleFiles=computed(()=>{
  const needle=query.value.trim().toLocaleLowerCase();
  const list=needle?files.value.filter(item=>(item.name||'').toLocaleLowerCase().includes(needle)):files.value.slice();
  const value=item=>sortBy.value==='size'?Number(item.size||0):sortBy.value==='time'?Date.parse(item.modified_time||0)||0:(item.name||'').toLocaleLowerCase();
  return list.sort((a,b)=>{if(a.kind!==b.kind)return a.kind==='drive#folder'?-1:1;const av=value(a),bv=value(b);return (typeof av==='string'?av.localeCompare(bv,'zh-CN'):(av-bv))*sortDirection.value});
});
const title=computed(()=>mode.value==='drive'?'我的 PikPak':mode.value==='search'?'全盘搜索':mode.value==='starred'?'收藏':mode.value==='recent'?'最近':mode.value==='myshares'?'我的分享':mode.value==='uploads'?'上传任务':mode.value==='downloads'?'本机下载':mode.value==='offline'?'离线下载':mode.value==='trash'?'回收站':mode.value==='settings'?'设置':(share.value?'分享文件':'打开分享'));

function size(value){let n=Number(value);if(!n)return '—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<4){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`}
function resetNavigationState(){pathStack.value=[{id:'',name:'全部文件'}];treeChildren.value={};treeExpanded.value=[];clearSelection()}
function restoreNavigationState(){if(!account.value.connected)return;try{const value=JSON.parse(localStorage.getItem(NAV_STATE_KEY)||'null');if(!value||typeof value!=='object')return;if(Array.isArray(value.path)&&value.path.length&&value.path.length<100)pathStack.value=value.path.map(item=>({id:String(item.id||''),name:String(item.name||'目录').slice(0,200)}));if(Array.isArray(value.expanded))treeExpanded.value=value.expanded.map(String).filter(Boolean).slice(0,1000);if(value.children&&typeof value.children==='object'&&!Array.isArray(value.children)){const safe={};for(const [id,nodes] of Object.entries(value.children).slice(0,1000))if(Array.isArray(nodes))safe[id]=nodes.slice(0,1000).map(node=>({id:String(node.id||''),name:String(node.name||'目录').slice(0,200),kind:'drive#folder'})).filter(node=>node.id);treeChildren.value=safe}}catch{localStorage.removeItem(NAV_STATE_KEY)}}
function persistNavigationState(){if(mode.value!=='drive'||!account.value.connected)return;try{localStorage.setItem(NAV_STATE_KEY,JSON.stringify({path:pathStack.value,expanded:treeExpanded.value,children:treeChildren.value}))}catch{}}
function resumeDrive(){const target=pathStack.value.at(-1)||{id:'',name:'全部文件'};return loadDrive(target.id,target.name,'replace')}
function icon(item){if(item.kind==='drive#folder')return '📁';if((item.mime_type||'').startsWith('video/'))return '🎬';if((item.mime_type||'').startsWith('image/'))return '🖼️';if((item.mime_type||'').startsWith('audio/'))return '🎵';return '📄'}
function contentUrl(item){const list=item?.medias||[];return list.find(x=>x.is_origin&&x.link?.url)?.link?.url||item?.web_content_link||list.find(x=>x.link?.url)?.link?.url||''}
function playbackSources(item){const list=Array.isArray(item?.medias)?item.medias:[],rank=value=>{const text=String(value||'').toUpperCase();return text.includes('1080')||text==='FHD'?1080:text.includes('720')||text==='HD'?720:text.includes('480')||text==='SD'?480:0},toUrl=media=>{let url=String(media?.link?.url||'');const type=String(media?.video?.video_type||media?.video_type||'').toLowerCase();if(type==='mpegts'&&!url.includes('ts_downloader'))url=`https://web-vod-xdrive.mypikpak.com/ts_downloader?client_id=UElLUEFLX1dFQg&url=${encodeURIComponent(url.replace(/[?&]ext=\.m3u8(?=&|$)/,'').replace(/[?&]$/,''))}`;return url},label=media=>{const text=String(media?.resolution_name||media?.video_stream_id||'').toUpperCase();return rank(text)?`${rank(text)}P`:(media?.is_origin?'原画':'转码')};const values=[...list.filter(media=>!media?.is_origin&&media?.link?.url).sort((a,b)=>rank(b.resolution_name||b.video_stream_id)-rank(a.resolution_name||a.video_stream_id)).map(media=>({url:toUrl(media),label:label(media)})),...list.filter(media=>media?.is_origin&&media?.link?.url).map(media=>({url:toUrl(media),label:'原画'})),...(item?.web_content_link?[{url:item.web_content_link,label:'原始文件'}]:[])];const seen=new Set();return values.filter(source=>/^https?:\/\//i.test(source.url)&&!seen.has(source.url)&&seen.add(source.url))}
function isVideo(item){return (item?.mime_type||'').startsWith('video/')||/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp)$/i.test(item?.name||'')}
function isAudio(item){return (item?.mime_type||'').startsWith('audio/')||/\.(mp3|wav|flac|aac|m4a|ogg|opus|ape|wma|amr|m4b|alac|aiff|aif|mid|midi|ra|dts|ac3|dsf|dff)$/i.test(item?.name||'')}
function isImage(item){return (item?.mime_type||'').startsWith('image/')||/\.(jpg|jpeg|png|gif|webp|bmp|avif|svg)$/i.test(item?.name||'')}
function isArchive(item){const mime=(item?.mime_type||'').toLowerCase();return mime.includes('zip')||mime.includes('rar')||mime.includes('7z')||mime.includes('compressed')||mime.includes('archive')||/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(item?.name||'')}
function canPreview(item){return isArchive(item)||isVideo(item)||isAudio(item)||isImage(item)||(item?.mime_type||'')==='application/pdf'||/\.(pdf|txt|log|md|json|xml|srt|ass|vtt)$/i.test(item?.name||'')||(item?.mime_type||'').startsWith('text/')}
function previewUrl(item){return (isVideo(item)?playbackSources(item)[0]?.url:'')||contentUrl(item)||(isImage(item)?item?.thumbnail_link||'':'')}
function markThumbFailed(item){thumbFailed.value={...thumbFailed.value,[item.id]:true}}
async function run(work){loading.value=true;error.value='';try{await work()}catch(e){error.value=e.message||String(e)}finally{loading.value=false}}
function clearSelection(){selected.value=null;selectedIds.value=[]}
async function loadDrive(parentId='', name='全部文件',stackMode=parentId?'push':'reset'){await run(async()=>{mode.value='drive';share.value=null;files.value=(await api.listDrive(parentId)).files;treeChildren.value={...treeChildren.value,[parentId]:files.value.filter(item=>item.kind==='drive#folder')};if(parentId&&!treeExpanded.value.includes(parentId))treeExpanded.value=[...treeExpanded.value,parentId];clearSelection();if(stackMode==='reset')pathStack.value=[{id:'',name}];else if(stackMode==='push')pathStack.value.push({id:parentId,name})})}
async function toggleTree(node){if(treeExpanded.value.includes(node.id)){treeExpanded.value=treeExpanded.value.filter(id=>id!==node.id);return}if(!Object.hasOwn(treeChildren.value,node.id)){try{const result=await api.listDrive(node.id);treeChildren.value={...treeChildren.value,[node.id]:(result.files||[]).filter(item=>item.kind==='drive#folder')}}catch(e){error.value=e.message||String(e);return}}treeExpanded.value=[...treeExpanded.value,node.id]}
async function openTree({node,path}){await run(async()=>{mode.value='drive';share.value=null;files.value=(await api.listDrive(node.id)).files;treeChildren.value={...treeChildren.value,[node.id]:files.value.filter(item=>item.kind==='drive#folder')};pathStack.value=[{id:'',name:'全部文件'},...path.map(item=>({id:item.id,name:item.name}))];clearSelection()})}
async function loadTrash(){await run(async()=>{mode.value='trash';share.value=null;files.value=(await api.listTrash()).files;clearSelection();pathStack.value=[{id:'trash',name:'回收站'}]})}
async function loadStarred(){await run(async()=>{mode.value='starred';share.value=null;files.value=(await api.listStarred()).files;clearSelection();pathStack.value=[{id:'starred',name:'收藏'}]})}
async function loadRecent(){await run(async()=>{mode.value='recent';share.value=null;files.value=(await api.listRecent()).files;clearSelection();pathStack.value=[{id:'recent',name:'最近'}]})}
async function searchAll(){const value=globalQuery.value.trim();if(value.length<2)return;searchLive.value={scanned:0,folders:0,matchesCount:0,isDone:false};await run(async()=>{mode.value='search';share.value=null;const result=await api.searchDrive(value);files.value=result.files||[];searchStats.value=result;query.value='';clearSelection();pathStack.value=[{id:'search',name:`搜索：${value}`}]})}
async function cancelSearch(){try{await api.cancelSearch();loading.value=false}catch(e){error.value=e.message||String(e)}}
async function loadMyShares(){await run(async()=>{mode.value='myshares';share.value=null;files.value=(await api.listMyShares()).files;clearSelection();pathStack.value=[{id:'myshares',name:'我的分享'}]})}
async function loadShare(rawUrl,name='分享根目录',reset=false){await run(async()=>{const result=await api.openShare(rawUrl);mode.value='share';share.value=result.share;files.value=result.files;clearSelection();const part={id:result.share.parentToken||'root',name,url:result.share.url};if(reset)pathStack.value=[part];else pathStack.value.push(part);if(!result.bridgeAvailable&&!files.value.some(item=>item.encodedToken))error.value='目录已加载，但页面桥接暂不可用，子目录可能无法进入'})}
async function openShare(){const raw=shareUrl.value.trim();if(!raw)return;await loadShare(raw,'分享根目录',true)}
async function hydrateFile(item){
  if(item.kind==='drive#folder'||!['drive','starred','recent','search','share'].includes(mode.value))return item;
  try{
    const detail=mode.value==='share'
      ? await api.getShareFile({shareId:share.value.shareId,fileId:item.id})
      : await api.getDriveFile(item.id);
    const merged={...item,...(detail.file||detail)};if(selected.value?.id===item.id)selected.value=merged;return merged;
  }catch(e){error.value=e.message||String(e);return item}
}
async function openItem(item){if(item.kind==='pikpak#share'){selected.value=item;selectedIds.value=[item.id];await copyMyShare();return}if(item.kind==='drive#folder'){if(mode.value==='search'){pathStack.value=[{id:'',name:'全部文件'},{id:item.id,name:item.name}];await loadDrive(item.id,item.name,'replace')}else if(['drive','starred','recent'].includes(mode.value)){await loadDrive(item.id,item.name)}else if(item.encodedToken){const url=new URL(share.value.url);const parts=url.pathname.split('/').filter(Boolean),index=parts.indexOf('s');url.pathname='/'+parts.slice(0,index+2).concat(item.encodedToken).join('/');await loadShare(url.href,item.name,false)}else{error.value='该目录没有可用的进入 token，请刷新后重试'}return}selected.value=item;selectedIds.value=[item.id];await openSelected()}
async function selectItem(item,event){const additive=!!(event?.ctrlKey||event?.metaKey);if(additive){selectedIds.value=selectedIds.value.includes(item.id)?selectedIds.value.filter(id=>id!==item.id):[...selectedIds.value,item.id];selected.value=selectedIds.value.includes(item.id)?item:(selectedItems.value.at(-1)||null)}else{selectedIds.value=[item.id];selected.value=item}if(selected.value?.id===item.id)await hydrateFile(item)}
async function downloadSelected(){
  if(!selectedItems.value.length)return;
  let started=0;
  for(const rawRoot of selectedItems.value){
    if(rawRoot.kind==='drive#folder'){
      const queue=[{id:rawRoot.id,relDir:rawRoot.name,encodedToken:rawRoot.encodedToken||''}];
      while(queue.length){
        const current=queue.shift();
        try{
          let children=[];
          if(mode.value==='share'&&share.value?.url){
            const url=new URL(share.value.url);
            const parts=url.pathname.split('/').filter(Boolean),index=parts.indexOf('s');
            if(current.encodedToken){
              url.pathname='/'+parts.slice(0,index+2).concat(current.encodedToken).join('/');
            }
            const res=await api.openShare(url.href);
            children=res.files||[];
          }else{
            const res=await api.listDrive(current.id);
            children=res.files||[];
          }
          for(const child of children){
            if(child.kind==='drive#folder'){
              queue.push({id:child.id,relDir:`${current.relDir}/${child.name}`,encodedToken:child.encodedToken||''});
            }else{
              const item=await hydrateFile(child);
              const url=contentUrl(item);
              if(url){
                const task=await api.startDownload({url,name:item.name,subDir:current.relDir});
                upsertDownload(task);
                started++;
              }
            }
          }
        }catch(e){
          error.value=`读取目录“${current.relDir}”失败: `+(e.message||String(e));
        }
      }
    }else{
      const item=await hydrateFile(rawRoot);
      const url=contentUrl(item);
      if(url){
        const task=await api.startDownload({url,name:item.name,subDir:''});
        upsertDownload(task);
        started++;
      }
    }
  }
  if(!started){
    if(!error.value)error.value='选中项中没有可用下载内容或为空文件夹';
  }else{
    mode.value='downloads';
  }
}
async function loadArchivePath(pathValue='',nodes=[]){const state=archive.value;if(!state.request)return;state.loading=true;state.error='';state.items=[];try{let result=await api.listArchive({...state.request,path:pathValue,password:state.password});if(result.passwordRequired){const password=window.prompt(result.message||'请输入压缩包密码');if(password===null){if(!state.items.length)state.open=false;return}state.password=password;result=await api.listArchive({...state.request,path:pathValue,password});if(result.passwordRequired)throw new Error('压缩包密码不正确')}state.items=result.items||[];state.path=pathValue;state.nodes=nodes}catch(e){state.error=e.message||String(e)}finally{state.loading=false}}
async function openArchive(item){archive.value={open:true,name:item.name,items:[],path:'',nodes:[{name:'全部',path:''}],password:'',loading:false,error:'',request:{scope:mode.value==='share'?'share':'drive',fileId:item.id,shareId:share.value?.shareId||'',passCodeToken:share.value?.passCodeToken||''}};await loadArchivePath('',archive.value.nodes)}
async function enterArchiveFolder(item){const name=item.name||'目录',pathValue=item.path||`${archive.value.path}${name}/`;await loadArchivePath(pathValue,[...archive.value.nodes,{name,path:pathValue}])}
async function navigateArchiveCrumb(index){const nodes=archive.value.nodes.slice(0,index+1);await loadArchivePath(nodes.at(-1)?.path||'',nodes)}
function imageViewerItems(current){
  const all=visibleFiles.value.filter(isImage),index=Math.max(0,all.findIndex(entry=>entry.id===current.id));
  const start=Math.max(0,Math.min(index-30,all.length-60));
  return all.slice(start,start+60).map(entry=>{
    const value=entry.id===current.id?current:entry;
    return {id:String(value.id||''),name:value.name||'图片',url:previewUrl(value)};
  }).filter(entry=>/^https?:\/\//i.test(entry.url));
}
function matchSubtitles(videoName,fileList){const subExtensions=new Set(['srt','vtt','ass']);const subFiles=(fileList||[]).filter(item=>{if(!item||item.kind==='drive#folder')return false;const ext=String(item.name||'').split('.').pop()?.toLowerCase();return subExtensions.has(ext)});if(!subFiles.length)return [];const baseName=String(videoName||'').replace(/\.[^/.]+$/,'').trim().toLowerCase();const scored=subFiles.map(file=>{const subBase=String(file.name).replace(/\.[^/.]+$/,'').trim().toLowerCase();let score=0;if(subBase===baseName)score=100;else if(subBase.startsWith(baseName))score=80;else if(baseName.startsWith(subBase))score=70;else{const videoTokens=new Set(baseName.split(/[._\-\s]+/).filter(t=>t.length>1)),subTokens=subBase.split(/[._\-\s]+/).filter(t=>t.length>1),overlap=subTokens.filter(t=>videoTokens.has(t)).length;if(overlap>0)score=Math.min(60,overlap*20);else score=10}return {file,score}});return scored.filter(item=>item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.file)}
async function matchedSubtitlesFor(item){if(!isVideo(item))return [];const subs=matchSubtitles(item.name,files.value).slice(0,5),result=[];for(const sub of subs){let hydrated=sub;if(!contentUrl(hydrated)){try{hydrated=await hydrateFile(sub)}catch{}}const url=contentUrl(hydrated);if(url)result.push({id:sub.id,name:sub.name,url})}return result}
async function openSelected(){if(selectedItems.value.length!==1)return;const item=await hydrateFile(selectedItems.value[0]);if(!canPreview(item)){error.value='此文件类型暂不支持预览，请明确点击下载按钮后在本机打开';return}if(isArchive(item)){await openArchive(item);return}const url=previewUrl(item);if(!url){error.value='当前文件没有可用的查看地址';return}try{const progressId=mode.value==='share'?`share:${share.value?.shareId||''}:${item.id}`:`drive:${item.id}`;const subtitles=isVideo(item)?await matchedSubtitlesFor(item):[];await api.openViewer({url,name:item.name,fileId:progressId,mimeType:item.mime_type||'',sources:isVideo(item)?playbackSources(item):[],items:isImage(item)?imageViewerItems(item):[],subtitles})}catch(e){error.value=e.message||String(e)}}
async function itemAction(item,action){selectedIds.value=[item.id];selected.value=item;const actions={open:openSelected,download:downloadSelected,save:saveShareSelected,share:createShareSelected,star:toggleStarred,copy:()=>stageTransfer('copy'),move:()=>stageTransfer('move'),rename:renameSelected,trash:trashSelected,restore:restoreSelected,delete:deleteForever,copyShare:copyMyShare,cancelShare:cancelMyShares};await actions[action]?.()}
async function loadSaveDialogFolders(parentId){shareSaveDialog.value.loading=true;try{const res=await api.listDrive(parentId);shareSaveDialog.value.folders=(res.files||[]).filter(item=>item.kind==='drive#folder')}catch(e){error.value=e.message||String(e)}finally{shareSaveDialog.value.loading=false}}
async function navigateSaveDialog(folder){shareSaveDialog.value.targetId=folder.id;shareSaveDialog.value.targetName=folder.name;shareSaveDialog.value.path.push(folder);await loadSaveDialogFolders(folder.id)}
async function navigateSaveDialogCrumb(index){shareSaveDialog.value.path=shareSaveDialog.value.path.slice(0,index+1);const current=shareSaveDialog.value.path.at(-1);shareSaveDialog.value.targetId=current?.id||'';shareSaveDialog.value.targetName=current?.name||'根目录';await loadSaveDialogFolders(shareSaveDialog.value.targetId)}
async function saveShareSelected(){if(!selectedItems.value.length||mode.value!=='share'||!share.value)return;if(!account.value.connected){error.value='请先连接 PikPak 账户，再保存分享文件';return}shareSaveDialog.value={open:true,targetId:'',targetName:'根目录',folders:[],loading:true,path:[{id:'',name:'根目录'}]};await loadSaveDialogFolders('')}
async function confirmSaveShare(toParentId=''){
  shareSaveDialog.value.open=false;
  const items=selectedItems.value.slice();
  await run(async()=>{
    await api.restoreShare({shareId:share.value.shareId,passCodeToken:share.value.passCodeToken||'',fileIds:items.map(item=>item.id),toParentId:toParentId||undefined});
    const targetLabel=toParentId?`到「${shareSaveDialog.value.targetName}」`:'到我的网盘根目录';
    if(items.length>2){
      showBatchResult({title:'分享保存完成',operation:'saveShare',details:items.map(i=>({name:i.name,status:'success',message:`已保存${targetLabel}`}))});
    }else{
      notice.value=`已提交保存 ${items.length} 项${targetLabel}`;
      setTimeout(()=>{notice.value=''},4000);
    }
  });
}
async function createShareSelected(){if(!selectedItems.value.length)return;await run(async()=>{const result=await api.createShare({ids:selectedItems.value.map(item=>item.id),expirationDays:7,encrypted:true});notice.value=`分享链接已复制${result.passCode?`，提取码 ${result.passCode}`:''}`;setTimeout(()=>{notice.value=''},6000)})}
async function copyMyShare(){if(selectedItems.value.length!==1)return;const item=selectedItems.value[0];await api.copyShare({shareUrl:item.share_url,passCode:item.pass_code});notice.value=`“${item.name}”的链接已复制`;setTimeout(()=>{notice.value=''},3500)}
async function cancelMyShares(){if(!selectedItems.value.length||!window.confirm(`取消选中的 ${selectedItems.value.length} 个分享？原网盘文件不会被删除。`))return;await run(async()=>{await api.cancelShares(selectedItems.value.map(item=>item.id));notice.value='分享已取消';await loadMyShares();setTimeout(()=>{notice.value=''},3500)})}
function offlineName(task){return task.name||task.file_name||task.reference_resource?.name||task.source_url||'离线任务'}
function offlinePhase(task){const phase=String(task.phase||'').toUpperCase();if(phase.includes('COMPLETE'))return '已完成';if(phase.includes('ERROR')||phase.includes('FAILED'))return '失败';if(phase.includes('PAUSED'))return '已暂停';if(phase.includes('RUNNING'))return '下载中';return '等待中'}
function offlinePercent(task){const value=Number(task.progress||task.progress_percent||0);return Math.max(0,Math.min(100,Math.round(value<=1?value*100:value)))}
async function loadOffline(){await run(async()=>{mode.value='offline';offlineTasks.value=(await api.listOfflineTasks()).tasks||[];selected.value=null})}
async function createOffline(){const value=offlineUrl.value.trim();if(!value)return;await run(async()=>{await api.createOfflineTask(value);offlineUrl.value='';notice.value='离线下载任务已创建';await loadOffline();setTimeout(()=>{notice.value=''},4000)})}
async function deleteOffline(id){if(!window.confirm('删除这条离线任务记录？已保存的文件不会被删除。'))return;await run(async()=>{await api.deleteOfflineTask(id);await loadOffline()})}
function itemIsStarred(item){return !!(item?.starred||(item?.tags||[]).some(tag=>tag?.name==='STAR'))}
async function toggleStarred(){if(!selectedItems.value.length)return;const value=selectedItems.value.some(item=>!itemIsStarred(item));await run(async()=>{await api.setStarred({ids:selectedItems.value.map(item=>item.id),starred:value});notice.value=value?`已收藏 ${selectedItems.value.length} 项`:`已取消收藏 ${selectedItems.value.length} 项`;if(mode.value==='starred')await loadStarred();else{files.value=files.value.map(item=>selectedIds.value.includes(item.id)?{...item,starred:value}:item);if(selected.value)selected.value={...selected.value,starred:value}}setTimeout(()=>{notice.value=''},3000)})}
function upsertDownload(task){const index=downloads.value.findIndex(item=>item.id===task.id);if(index<0)downloads.value.unshift(task);else downloads.value[index]={...downloads.value[index],...task}}
function upsertUpload(task){const index=uploads.value.findIndex(item=>item.id===task.id);if(index<0)uploads.value.unshift(task);else uploads.value[index]={...uploads.value[index],...task};if(task.state==='completed'&&mode.value==='drive')setTimeout(()=>resumeDrive(),700)}
async function chooseUpload(){const parentId=mode.value==='drive'?(pathStack.value.at(-1)?.id||''):'';const tasks=await api.chooseUpload({parentId});for(const task of tasks)upsertUpload(task)}
async function chooseUploadFolder(){const tasks=await api.chooseUploadFolder({parentId:pathStack.value.at(-1)?.id||''});for(const task of tasks)upsertUpload(task);await resumeDrive()}
async function dropFiles(event){dragUpload.value=false;if(mode.value!=='drive'||!account.value.connected)return;const files=event.dataTransfer?.files;if(!files?.length)return;try{const tasks=await api.uploadDroppedFiles(files,{parentId:pathStack.value.at(-1)?.id||''});for(const task of tasks)upsertUpload(task)}catch(e){error.value=e.message||String(e)}}
function leaveDrop(event){if(!event.currentTarget.contains(event.relatedTarget))dragUpload.value=false}
function uploadState(task){return task.state==='completed'?'已完成':task.state==='failed'?'失败':task.state==='cancelled'?'已取消':task.state==='interrupted'?'已中断':task.state==='hashing'?'正在校验':task.state==='queued'?'等待中':'正在上传'}
async function clearFinishedUploads(){uploads.value=await api.clearUploads()}
async function removeUpload(id){uploads.value=await api.removeUpload(id)}
async function retryUploadTask(id){try{const task=await api.retryUpload(id);upsertUpload(task)}catch(e){error.value=e.message||String(e)}}
async function retryDownloadTask(id){try{const task=await api.retryDownload(id);upsertDownload(task)}catch(e){error.value=e.message||String(e)}}
async function chooseDownloadDirectory(){const value=await api.chooseDownloadDirectory();if(value)settings.value.downloadDirectory=value}
async function persistSettings(){try{settings.value=await api.saveSettings(settings.value);notice.value='设置已保存';setTimeout(()=>{notice.value=''},2500)}catch(e){error.value=e.message||String(e)}}
async function resetSettingsToDefault(){if(!window.confirm('确定将所有设置恢复为默认值吗？'))return;try{settings.value=await api.resetSettings();notice.value='已恢复默认设置';setTimeout(()=>{notice.value=''},2500)}catch(e){error.value=e.message||String(e)}}
async function clearAllDataCache(){if(!window.confirm('确定要清理本机的下载历史、上传历史、播放进度和会话缓存吗？云端网盘文件不会受到影响。'))return;try{await api.clearAppCache();downloads.value=[];uploads.value=[];notice.value='已清理本机缓存与传输历史记录';setTimeout(()=>{notice.value=''},3000)}catch(e){error.value=e.message||String(e)}}
async function exportDiagnosticsReport(){try{const report=await api.exportDiagnostics();const text=JSON.stringify(report,null,2);const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`pikpak-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`;a.click();URL.revokeObjectURL(url);notice.value='诊断报告已导出';setTimeout(()=>{notice.value=''},3000)}catch(e){error.value=e.message||String(e)}}
function setSort(key){if(sortBy.value===key)sortDirection.value*=-1;else{sortBy.value=key;sortDirection.value=1}}
async function clearDownloadHistory(){downloads.value=await api.clearDownloads()}
async function removeDownload(id){downloads.value=await api.removeDownload(id)}
async function refreshQuota(){if(!account.value.connected){quota.value=null;return}try{quota.value=(await api.getAccountAbout()).quota}catch{quota.value=null}}
async function saveToken(){account.value=await api.setAccessToken(token.value.trim());token.value='';if(account.value.connected){restoreNavigationState();refreshQuota();resumeDrive()}}
async function webLogin(){await run(async()=>{account.value=await api.login();if(account.value.connected){restoreNavigationState();await Promise.all([refreshQuota(),resumeDrive()])}})}
async function logout(){await run(async()=>{account.value=await api.logout();quota.value=null;files.value=[];resetNavigationState();try{localStorage.removeItem(NAV_STATE_KEY)}catch{}})}
async function createFolder(){const name=window.prompt('新文件夹名称');if(!name?.trim())return;await run(async()=>{await api.createFolder({parentId:pathStack.value.at(-1)?.id||'',name:name.trim()});await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace')})}
async function renameSelected(){if(!selected.value)return;const name=window.prompt('新名称',selected.value.name);if(!name?.trim()||name.trim()===selected.value.name)return;await run(async()=>{await api.rename({id:selected.value.id,name:name.trim()});await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace')})}
function stageTransfer(operation){if(!selectedItems.value.length)return;clipboard.value={operation,items:selectedItems.value.map(({id,name,kind})=>({id,name,kind})),sourceParentId:pathStack.value.at(-1)?.id||''}}
function showBatchResult({title,operation,details}){
  const successCount=details.filter(d=>d.status==='success').length;
  const skipCount=details.filter(d=>d.status==='skipped').length;
  const failCount=details.filter(d=>d.status==='failed').length;
  batchResultModal.value={open:true,title:title||'批量操作完成',operation:operation||'',successCount,skipCount,failCount,details};
}
function detectConflicts(sources,targets){
  const targetMap=new Map();
  for(const t of targets||[]){if(t?.name)targetMap.set(String(t.name).trim().toLowerCase(),t)}
  const conflicts=[],nonConflicts=[];
  for(const s of sources||[]){
    const key=String(s?.name||'').trim().toLowerCase();
    if(key&&targetMap.has(key))conflicts.push({source:s,existing:targetMap.get(key)});
    else if(s)nonConflicts.push(s);
  }
  return {conflicts,nonConflicts};
}
function generateUniqueName(name,existingNames){
  const existingSet=new Set((existingNames||[]).map(n=>String(n).trim().toLowerCase()));
  const trimmed=String(name||'未命名').trim();
  if(!existingSet.has(trimmed.toLowerCase()))return trimmed;
  const dotIdx=trimmed.lastIndexOf('.'),hasExt=dotIdx>0&&dotIdx<trimmed.length-1;
  const base=hasExt?trimmed.slice(0,dotIdx):trimmed,ext=hasExt?trimmed.slice(dotIdx):'';
  let candidate=`${base} - 副本${ext}`,count=2;
  while(existingSet.has(candidate.toLowerCase())){candidate=`${base} - 副本 (${count})${ext}`;count++}
  return candidate;
}
async function executeTransfer(operation,items,targetId,extraDetails=[]){
  await run(async()=>{
    try{
      if(items.length)await api.transfer({operation,ids:items.map(item=>item.id),parentId:targetId});
      if(operation==='move')clipboard.value=null;
      await loadDrive(targetId,pathStack.value.at(-1)?.name,'replace');
      const details=[...items.map(i=>({name:i.name,status:'success',message:operation==='move'?'已剪切并移动':'已复制'})),...extraDetails];
      if(extraDetails.length>0||details.length>2){
        showBatchResult({title:operation==='move'?'批量移动完成':'批量复制完成',operation,details});
      }else{
        notice.value=`${operation==='move'?'已移动':'已复制'} ${items.length} 项`;
        setTimeout(()=>{notice.value=''},3500);
      }
    }catch(e){error.value=e.message||String(e)}
  });
}
async function pasteTransfer(){
  if(!clipboard.value||mode.value!=='drive')return;
  const targetId=pathStack.value.at(-1)?.id||'';
  if(clipboard.value.sourceParentId===targetId){error.value='源目录与目标目录相同';return}
  const {conflicts,nonConflicts}=detectConflicts(clipboard.value.items,files.value);
  if(conflicts.length>0){
    conflictDialog.value={open:true,operation:clipboard.value.operation,conflicts,nonConflicts,targetId,targetName:pathStack.value.at(-1)?.name||'当前目录',loading:false};
  }else{
    await executeTransfer(clipboard.value.operation,clipboard.value.items,targetId);
  }
}
async function resolveConflicts(strategy){
  const {operation,conflicts,nonConflicts,targetId}=conflictDialog.value;
  conflictDialog.value.loading=true;
  try{
    if(strategy==='skip'){
      conflictDialog.value.open=false;
      const skippedDetails=conflicts.map(c=>({name:c.source.name,status:'skipped',message:'目标目录存在同名项，已跳过'}));
      await executeTransfer(operation,nonConflicts,targetId,skippedDetails);
    }else if(strategy==='overwrite'){
      conflictDialog.value.open=false;
      await api.trash(conflicts.map(c=>c.existing.id));
      const allItems=[...nonConflicts,...conflicts.map(c=>c.source)];
      const overwriteDetails=conflicts.map(c=>({name:c.source.name,status:'success',message:'已覆盖原有同名项'}));
      await executeTransfer(operation,allItems,targetId,overwriteDetails);
    }else if(strategy==='rename'){
      conflictDialog.value.open=false;
      const existingNames=files.value.map(f=>f.name),renamedDetails=[],transferredSuccess=[...nonConflicts];
      for(const c of conflicts){
        const unique=generateUniqueName(c.source.name,existingNames);
        existingNames.push(unique);
        if(operation==='move'){
          await api.rename({id:c.source.id,name:unique});
          transferredSuccess.push({...c.source,name:unique});
          renamedDetails.push({name:`${c.source.name} → ${unique}`,status:'success',message:'已重命名并移动'});
        }else{
          await api.rename({id:c.source.id,name:unique});
          await api.transfer({operation:'copy',ids:[c.source.id],parentId:targetId});
          await api.rename({id:c.source.id,name:c.source.name});
          renamedDetails.push({name:`${c.source.name} (副本: ${unique})`,status:'success',message:'已重命名并复制'});
        }
      }
      if(operation==='move')clipboard.value=null;
      await loadDrive(targetId,pathStack.value.at(-1)?.name,'replace');
      const details=[...nonConflicts.map(i=>({name:i.name,status:'success',message:operation==='move'?'已剪切并移动':'已复制'})),...renamedDetails];
      showBatchResult({title:operation==='move'?'批量移动完成':'批量复制完成',operation,details});
    }
  }catch(e){error.value=e.message||String(e)}finally{conflictDialog.value.loading=false}
}
async function trashSelected(){
  if(!selectedItems.value.length||!window.confirm(`确定将选中的 ${selectedItems.value.length} 项移入回收站吗？`))return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.trash(items.map(item=>item.id));
    await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace');
    if(count>2){
      showBatchResult({title:'批量移入回收站完成',operation:'trash',details:items.map(i=>({name:i.name,status:'success',message:'已移入回收站'}))});
    }else{
      notice.value=`已将 ${count} 项移入回收站`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
async function restoreSelected(){
  if(!selectedItems.value.length)return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.restoreTrash(items.map(item=>item.id));
    await loadTrash();
    if(count>2){
      showBatchResult({title:'批量恢复完成',operation:'restore',details:items.map(i=>({name:i.name,status:'success',message:'已恢复至网盘'}))});
    }else{
      notice.value=`已恢复 ${count} 项`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
async function deleteForever(){
  if(!selectedItems.value.length||!window.confirm(`永久删除选中的 ${selectedItems.value.length} 项？此操作无法撤销。`))return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.deleteTrash(items.map(item=>item.id));
    await loadTrash();
    if(count>2){
      showBatchResult({title:'批量永久删除完成',operation:'delete',details:items.map(i=>({name:i.name,status:'success',message:'已永久删除'}))});
    }else{
      notice.value=`已永久删除 ${count} 项`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
function navigateCrumb(index){const target=pathStack.value[index];pathStack.value=pathStack.value.slice(0,index+1);if(mode.value==='drive')loadDrive(target.id,target.name,'replace');else if(target.url)loadShare(target.url,target.name,false)}
function refreshCurrent(){if(mode.value==='drive')loadDrive(pathStack.value.at(-1)?.id,'','replace');else if(mode.value==='share'&&share.value){pathStack.value.pop();loadShare(share.value.url,pathStack.value.at(-1)?.name||'分享目录',false)}}
watch([mode,pathStack,treeExpanded,treeChildren],persistNavigationState,{deep:true});
onMounted(async()=>{
  api.onDownload(upsertDownload);
  api.onUpload(upsertUpload);
  api.onSearchProgress(val=>{
    if(val)searchLive.value={...val};
    if(val?.matchesCount&&!searchStats.value)searchStats.value={scanned:val.scanned,folders:val.folders};
  });
  api.onAccountExpired(()=>{account.value={connected:false};quota.value=null;files.value=[];resetNavigationState();try{localStorage.removeItem(NAV_STATE_KEY)}catch{}});
  [downloads.value,uploads.value,settings.value]=await Promise.all([api.listDownloads(),api.listUploads(),api.getSettings()]);
  account.value=await api.getAccount();
  if(account.value.connected){restoreNavigationState();refreshQuota();resumeDrive()}else{resetNavigationState()}
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&selectedIds.value.length)clearSelection()});
})
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="logo">P</span><div><b>PikPak</b><small>Desktop</small></div></div>
      <nav>
        <button :class="{active:mode==='drive'}" @click="loadDrive()"><span>☁</span> 我的文件</button>
        <button :class="{active:mode==='search'}" @click="mode='search';files=[];searchStats=null;pathStack=[{id:'search',name:'全盘搜索'}];clearSelection()"><span>⌕</span> 全盘搜索</button>
        <button :class="{active:mode==='starred'}" @click="loadStarred"><span>★</span> 收藏</button>
        <button :class="{active:mode==='recent'}" @click="loadRecent"><span>◷</span> 最近</button>
        <button :class="{active:mode==='myshares'}" @click="loadMyShares"><span>♢</span> 我的分享</button>
        <button :class="{active:mode==='share'}" @click="mode='share';files=[];clearSelection()"><span>🔗</span> 分享链接</button>
        <button :class="{active:mode==='uploads'}" @click="mode='uploads';clearSelection()"><span>⇧</span> 上传任务 <small v-if="uploads.length">{{uploads.length}}</small></button>
        <button :class="{active:mode==='downloads'}" @click="mode='downloads';clearSelection()"><span>⇩</span> 下载任务 <small v-if="downloads.length">{{downloads.length}}</small></button>
        <button :class="{active:mode==='offline'}" @click="loadOffline"><span>⚡</span> 离线下载</button>
        <button :class="{active:mode==='trash'}" @click="loadTrash"><span>♲</span> 回收站</button>
        <button :class="{active:mode==='settings'}" @click="mode='settings';clearSelection()"><span>⚙</span> 设置</button>
      </nav>
      <div class="tree-title">当前目录</div>
      <button class="tree-root" :class="{active:mode==='drive'&&pathStack.at(-1)?.id===''}" @click="loadDrive()">📂 全部文件</button>
      <div class="tree-scroll"><FolderTree :nodes="treeChildren['']||[]" :children="treeChildren" :expanded="treeExpanded" :current-id="mode==='drive'?(pathStack.at(-1)?.id||''):''" @toggle="toggleTree" @open="openTree" /></div>
      <button v-if="account.connected" class="quota-card" title="点击刷新容量" @click="refreshQuota"><template v-if="quota"><span><b>存储空间</b><small>{{size(quota.used)}} / {{size(quota.limit)}}</small></span><em>{{quota.percent.toFixed(1)}}%</em><i><u :style="{width:quota.percent+'%'}"></u></i></template><span v-else><b>存储空间</b><small>点击刷新</small></span></button>
      <button class="account-card" @click="account.connected?logout():webLogin()"><span :class="['dot',{online:account.connected}]"></span>{{account.connected?'账户已连接 · 退出':'网页登录 PikPak'}}</button>
    </aside>

    <main class="main">
      <header class="toolbar">
        <div class="toolbar-top">
          <div class="toolbar-heading"><h1 :title="title">{{title}}</h1></div>
          <div class="toolbar-actions">
            <template v-if="selectedItems.length > 1">
              <span class="batch-count">已选 {{selectedItems.length}} 项</span>
              <button v-if="!['trash','myshares'].includes(mode)" class="soft" @click="downloadSelected">↓ 批量下载 ({{selectedItems.length}})</button>
              <button v-if="['drive','starred','recent','search'].includes(mode)" class="soft" @click="toggleStarred">{{selectedItems.some(item=>!itemIsStarred(item))?'★ 批量收藏':'批量取消收藏'}} ({{selectedItems.length}})</button>
              <button v-if="['drive','starred','recent','search'].includes(mode)" class="soft" @click="createShareSelected">🔗 批量分享 ({{selectedItems.length}})</button>
              <button v-if="mode==='drive'" class="soft" @click="stageTransfer('copy')">📋 批量复制</button>
              <button v-if="mode==='drive'" class="soft" @click="stageTransfer('move')">✂ 批量剪切</button>
              <button v-if="mode==='drive'" class="warn" @click="trashSelected">🗑 移入回收站 ({{selectedItems.length}})</button>
              <button v-if="mode==='trash'" class="soft" @click="restoreSelected">↶ 批量恢复 ({{selectedItems.length}})</button>
              <button v-if="mode==='trash'" class="warn" @click="deleteForever">🗑 永久删除 ({{selectedItems.length}})</button>
              <button v-if="mode==='share'&&share" class="accent" @click="saveShareSelected">💾 保存到网盘 ({{selectedItems.length}})</button>
              <button v-if="mode==='myshares'" class="warn" @click="cancelMyShares">批量取消分享 ({{selectedItems.length}})</button>
              <button class="soft" title="取消选择" @click="clearSelection">✕ 取消选择</button>
            </template>
            <template v-else>
              <input v-if="['drive','starred','recent','myshares','trash'].includes(mode)||(mode==='share'&&share)" v-model="query" class="search" placeholder="搜索当前目录">
              <button v-if="selectedItems.length===1&&!['trash','myshares'].includes(mode)" class="soft" @click="downloadSelected">↓ 下载</button>
              <button v-if="mode==='drive'&&clipboard" class="paste" @click="pasteTransfer">粘贴 {{clipboard.items.length}} 项</button>
              <button v-if="mode==='drive'&&account.connected" class="primary" @click="chooseUpload">↑ 上传文件</button>
              <button v-if="mode==='drive'&&account.connected" class="soft" @click="chooseUploadFolder">↑ 上传文件夹</button>
              <button v-if="mode==='drive'&&account.connected" class="soft" @click="createFolder">＋ 新建文件夹</button>
              <button v-if="!['uploads','downloads','trash','offline','starred','recent','myshares'].includes(mode)" class="soft" @click="refreshCurrent">↻ 刷新</button>
              <button v-if="mode==='starred'" class="soft" @click="loadStarred">↻ 刷新</button>
              <button v-if="mode==='recent'" class="soft" @click="loadRecent">↻ 刷新</button>
              <button v-if="mode==='myshares'" class="soft" @click="loadMyShares">↻ 刷新</button>
              <button v-if="mode==='trash'" class="soft" @click="loadTrash">↻ 刷新</button>
              <button v-if="mode==='offline'" class="soft" @click="loadOffline">↻ 刷新</button>
              <button v-if="mode==='uploads'&&uploads.some(task=>['completed','failed','cancelled'].includes(task.state))" class="soft" @click="clearFinishedUploads">清理记录</button>
              <button v-if="mode==='downloads'&&downloads.length" class="soft" @click="clearDownloadHistory">清理记录</button>
              <button class="primary" @click="mode='share';share=null;files=[];clearSelection()">＋ 打开分享</button>
            </template>
          </div>
        </div>
        <div class="toolbar-sub">
          <div class="crumbs"><template v-for="(part,i) in pathStack" :key="part.id"><button class="crumb-btn" :title="part.name" @click="navigateCrumb(i)">{{part.name}}</button><span v-if="i<pathStack.length-1" class="crumb-sep">›</span></template></div>
        </div>
      </header>
      <div v-if="notice" class="notice">✓ {{notice}}</div>
      <div v-if="uploads.some(task=>!['completed','failed','cancelled'].includes(task.state))" class="upload-float"><article v-for="task in uploads.filter(row=>!['completed','failed','cancelled'].includes(row.state))" :key="task.id"><span><b>{{task.name}}</b><small>{{task.state==='hashing'?'正在校验文件':task.state==='queued'?'等待上传':'正在上传'}} · {{task.percent||0}}%</small></span><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><button @click="api.cancelUpload(task.id)">取消</button></article></div>

      <section v-if="mode==='search'&&!searchStats" class="connect-panel search-all-panel"><div class="hero-icon">⌕</div><h2>搜索整个 PikPak</h2><p :class="{error}">{{error|| (loading?`正在遍历目录，已扫描 ${searchLive.folders} 个目录、${searchLive.scanned} 项，找到 ${searchLive.matchesCount} 项…`:'后台遍历网盘目录，并在结果中保留文件所在路径。')}}</p><form @submit.prevent="searchAll"><input v-model="globalQuery" autofocus placeholder="至少输入 2 个字符"><button class="primary" :disabled="loading">{{loading?'搜索中…':'开始搜索'}}</button><button v-if="loading" type="button" class="soft" @click="cancelSearch">取消搜索</button></form></section>
      <section v-else-if="mode==='uploads'" class="downloads-panel">
        <div v-if="!uploads.length" class="state">本次运行暂无上传任务</div>
        <article v-for="task in uploads" :key="task.id" class="download-row"><div class="download-icon">⇧</div><div class="download-info"><b>{{task.name}}</b><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><small :class="{error:task.state==='failed'}">{{uploadState(task)}} · {{task.percent||0}}%<template v-if="task.error"> · {{task.error}}</template></small></div><div class="download-actions"><button v-if="['failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="retryUploadTask(task.id)">重试</button><button v-if="!['completed','failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="api.cancelUpload(task.id)">取消</button><button v-else class="remove" title="移除记录" @click="removeUpload(task.id)">×</button></div></article>
      </section>
      <section v-else-if="mode==='downloads'" class="downloads-panel">
        <div v-if="!downloads.length" class="state">暂无下载任务</div>
        <article v-for="task in downloads" :key="task.id" class="download-row">
          <div class="download-icon">⇩</div><div class="download-info"><b>{{task.name}}<small v-if="task.subDir" class="download-subdir"> ({{task.subDir}})</small></b><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><small :class="{error:task.state==='failed'}">{{task.state==='completed'?'下载完成':task.state==='cancelled'?'已取消':task.state==='interrupted'?'下载中断':task.state==='failed'?'下载失败':`${task.percent||0}% · ${size(task.received)} / ${size(task.total)}`}}<template v-if="task.error"> · {{task.error}}</template></small></div>
          <div class="download-actions"><button v-if="task.state==='completed'" class="soft" @click="api.showDownload(task.path)">定位</button><button v-if="['failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="retryDownloadTask(task.id)">重试</button><button v-else-if="!['cancelled','interrupted','failed'].includes(task.state)" class="soft" @click="api.cancelDownload(task.id)">取消</button><button v-if="!['queued','progress'].includes(task.state)" class="remove" title="移除记录" @click="removeDownload(task.id)">×</button></div>
        </article>
      </section>
      <section v-else-if="mode==='offline'" class="offline-panel">
        <form class="offline-form" @submit.prevent="createOffline"><input v-model="offlineUrl" placeholder="粘贴磁力链、HTTP/HTTPS 或 ED2K 地址"><button class="primary">创建任务</button></form>
        <div v-if="loading" class="offline-state">正在加载…</div><div v-else-if="error" class="offline-state error">{{error}}</div><div v-else-if="!offlineTasks.length" class="offline-state">暂无离线下载任务</div>
        <article v-for="task in offlineTasks" :key="task.id||task.task_id" class="offline-row"><div class="download-icon">⚡</div><div class="download-info"><b>{{offlineName(task)}}</b><div class="progress"><i :style="{width:offlinePercent(task)+'%'}"></i></div><small>{{offlinePhase(task)}} · {{offlinePercent(task)}}%</small></div><button class="remove" title="删除任务" @click="deleteOffline(task.id||task.task_id)">×</button></article>
      </section>
      <section v-else-if="mode==='settings'" class="settings-panel">
        <h2>传输设置</h2><p>设置会保存在当前 Windows 用户中，重启客户端后继续生效。</p>
        <label><span><b>默认下载目录</b><small>{{settings.downloadDirectory||settings.effectiveDownloadDirectory||'系统下载目录'}}</small></span><button class="soft" @click="chooseDownloadDirectory">选择目录</button></label>
        <label><span><b>同时下载任务数</b><small>范围 1–8</small></span><input v-model.number="settings.downloadConcurrency" type="number" min="1" max="8"></label>
        <label><span><b>同时上传任务数</b><small>范围 1–8</small></span><input v-model.number="settings.uploadConcurrency" type="number" min="1" max="8"></label>
        <h2>系统诊断</h2><p>用于排查问题，诊断信息已自动脱敏，不含账户 Token 或敏感密码。</p>
        <div class="settings-actions"><button class="soft" @click="exportDiagnosticsReport">导出诊断报告 (JSON)</button><button class="warn" @click="resetSettingsToDefault">恢复默认设置</button></div>
        <h2>数据与缓存管理</h2><p>一键清理本机存储的下载/上传历史、播放进度与网络会话缓存。清理不会删除云端网盘文件。</p>
        <div class="settings-actions"><button class="warn" @click="clearAllDataCache">一键清理缓存与记录</button></div>
        <footer><button class="primary" @click="persistSettings">保存设置</button></footer>
      </section>
      <section v-else-if="mode==='share'&&!share" class="connect-panel">
        <div class="hero-icon">🔗</div><h2>打开 PikPak 分享</h2><p>粘贴公开分享链接，在桌面客户端中浏览和预览文件。</p>
        <form @submit.prevent="openShare"><input v-model="shareUrl" placeholder="https://mypikpak.com/s/…"><button class="primary">打开分享</button></form>
      </section>
      <section v-else-if="mode==='drive'&&!account.connected" class="connect-panel">
        <div class="hero-icon">🔐</div><h2>连接 PikPak 账户</h2><p>在官方 PikPak 窗口完成登录，客户端会安全接收授权并加密保存。</p>
        <button class="primary login-main" @click="webLogin">打开 PikPak 登录</button>
        <details><summary>高级：使用 Access Token</summary><form @submit.prevent="saveToken"><input v-model="token" type="password" placeholder="Access Token"><button class="soft">连接</button></form></details>
      </section>
      <section v-else class="content">
        <div :class="['file-panel',{'drop-active':dragUpload}]" @dragenter.prevent="mode==='drive'&&account.connected&&(dragUpload=true)" @dragover.prevent @dragleave="leaveDrop" @drop.prevent="dropFiles">
          <div v-if="mode==='search'&&searchStats" class="search-summary"><form @submit.prevent="searchAll"><input v-model="globalQuery" placeholder="输入新的搜索关键词"><button class="primary" :disabled="loading">{{loading?'搜索中…':'重新搜索'}}</button><button v-if="loading" type="button" class="soft" @click="cancelSearch">取消搜索</button></form><small>已扫描 {{searchLive.folders||searchStats.folders}} 个目录、{{searchLive.scanned||searchStats.scanned}} 项，找到 {{files.length}} 项<span v-if="searchStats.truncated">（结果已达到安全上限）</span></small></div>
          <div class="list-head"><button @click="setSort('name')">名称 {{sortBy==='name'?(sortDirection>0?'↑':'↓'):''}}</button><button @click="setSort('size')">大小 {{sortBy==='size'?(sortDirection>0?'↑':'↓'):''}}</button><button @click="setSort('time')">修改时间 {{sortBy==='time'?(sortDirection>0?'↑':'↓'):''}}</button><span>操作</span></div>
          <div v-if="loading" class="state">正在加载…</div><div v-else-if="error" class="state error">{{error}}</div><div v-else-if="!files.length" class="state">这个目录是空的</div>
          <div v-for="item in visibleFiles" :key="item.id" :class="['file-row',{selected:selectedIds.includes(item.id)}]" role="button" tabindex="0" :title="item.kind==='drive#folder'?'双击进入文件夹':canPreview(item)?'双击打开':'此类型需明确点击下载按钮后在本机打开'" @click="selectItem(item,$event)" @dblclick="openItem(item)" @keydown.enter="openItem(item)">
            <span class="file-name"><i class="row-check">{{selectedIds.includes(item.id)?'✓':''}}</i><span class="file-visual"><img v-if="item.thumbnail_link&&!thumbFailed[item.id]&&item.kind!=='drive#folder'" :src="item.thumbnail_link" alt="" loading="lazy" @error="markThumbFailed(item)"><i v-else>{{icon(item)}}</i></span><span><b>{{item.name}}</b><small>{{item._search_path||item.mime_type||item.kind}}</small></span></span><span>{{size(item.size)}}</span><span>{{item.modified_time?new Date(item.modified_time).toLocaleString():'—'}}</span>
            <span class="row-actions"><button v-if="item.kind!=='drive#folder'&&canPreview(item)" @click.stop="itemAction(item,'open')">打开</button><button v-if="!['trash','myshares'].includes(mode)" @click.stop="itemAction(item,'download')">下载</button><button v-if="mode==='share'" class="accent" @click.stop="itemAction(item,'save')">保存</button><button v-if="['drive','starred','recent','search'].includes(mode)" @click.stop="itemAction(item,'share')">分享</button><button v-if="['drive','starred','recent','search'].includes(mode)" @click.stop="itemAction(item,'star')">{{itemIsStarred(item)?'取消收藏':'收藏'}}</button><template v-if="mode==='drive'"><button @click.stop="itemAction(item,'copy')">复制</button><button @click.stop="itemAction(item,'move')">剪切</button><button @click.stop="itemAction(item,'rename')">重命名</button><button class="warn" @click.stop="itemAction(item,'trash')">回收站</button></template><template v-if="mode==='trash'"><button @click.stop="itemAction(item,'restore')">恢复</button><button class="warn" @click.stop="itemAction(item,'delete')">删除</button></template><template v-if="mode==='myshares'"><button @click.stop="itemAction(item,'copyShare')">复制链接</button><button class="warn" @click.stop="itemAction(item,'cancelShare')">取消分享</button></template></span>
          </div>
        </div>
      </section>
    </main>
    <div v-if="archive.open" class="archive-overlay" @click.self="archive.open=false">
      <section class="archive-dialog" role="dialog" aria-modal="true" :aria-label="archive.name">
        <header><div><small>压缩包内容</small><h2>{{archive.name}}</h2></div><button class="remove" title="关闭" @click="archive.open=false">×</button></header>
        <nav class="archive-crumbs"><button v-for="(part,index) in archive.nodes" :key="part.path" @click="navigateArchiveCrumb(index)">{{part.name}}<span v-if="index<archive.nodes.length-1">›</span></button></nav>
        <div class="archive-head"><span>名称</span><span>大小</span></div>
        <div class="archive-list">
          <div v-if="archive.loading" class="archive-state">正在读取压缩包…</div><div v-else-if="archive.error" class="archive-state error">{{archive.error}}</div><div v-else-if="!archive.items.length" class="archive-state">此目录为空</div>
          <button v-for="item in archive.items" :key="`${item.index}:${item.path}:${item.name}`" class="archive-row" :disabled="item.kind!=='drive#folder'" :title="item.kind==='drive#folder'?'双击进入目录':'只读查看，不会下载'" @dblclick="item.kind==='drive#folder'&&enterArchiveFolder(item)"><span><i>{{item.kind==='drive#folder'?'📁':'📄'}}</i>{{item.name}}</span><em>{{item.kind==='drive#folder'?'—':size(item.size)}}</em></button>
        </div>
        <footer>只读查看 · 不会下载或解压文件</footer>
      </section>
    </div>
    <div v-if="shareSaveDialog.open" class="archive-overlay" @click.self="shareSaveDialog.open=false">
      <section class="archive-dialog" role="dialog" aria-modal="true" aria-label="选择保存位置">
        <header><div><small>保存分享文件到我的 PikPak</small><h2>保存到：{{shareSaveDialog.targetName}}</h2></div><button class="remove" title="关闭" @click="shareSaveDialog.open=false">×</button></header>
        <nav class="archive-crumbs"><button v-for="(part,index) in shareSaveDialog.path" :key="part.id" @click="navigateSaveDialogCrumb(index)">{{part.name}}<span v-if="index<shareSaveDialog.path.length-1">›</span></button></nav>
        <div class="archive-head"><span>网盘文件夹</span><span>操作</span></div>
        <div class="archive-list">
          <div v-if="shareSaveDialog.loading" class="archive-state">正在加载文件夹…</div>
          <div v-else-if="!shareSaveDialog.folders.length" class="archive-state">当前目录下暂无子文件夹，可直接点击下方按钮保存到此处</div>
          <button v-for="folder in shareSaveDialog.folders" :key="folder.id" class="archive-row" title="点击选择并进入" @click="navigateSaveDialog(folder)"><span><i>📁</i>{{folder.name}}</span><em>进入 ›</em></button>
        </div>
        <footer class="share-dialog-actions">
          <button class="soft" @click="confirmSaveShare('')">直接保存到根目录</button>
          <button class="primary" @click="confirmSaveShare(shareSaveDialog.targetId)">保存到当前目录 ({{shareSaveDialog.targetName}})</button>
        </footer>
      </section>
    </div>
    <div v-if="conflictDialog.open" class="archive-overlay" @click.self="conflictDialog.open=false">
      <section class="archive-dialog conflict-dialog" role="dialog" aria-modal="true" aria-label="目标重名冲突">
        <header>
          <div><small>复制 / 移动重名冲突</small><h2>发现 {{conflictDialog.conflicts.length}} 项同名冲突</h2></div>
          <button class="remove" title="关闭" @click="conflictDialog.open=false">×</button>
        </header>
        <div class="conflict-summary">
          目标目录「{{conflictDialog.targetName}}」已存在同名项目。请选择冲突处理方式：
        </div>
        <div class="archive-list conflict-list">
          <div v-for="c in conflictDialog.conflicts" :key="c.source.id" class="archive-row conflict-row">
            <span><i>⚠️</i><b>{{c.source.name}}</b></span>
            <em>已有同名项</em>
          </div>
        </div>
        <footer class="conflict-dialog-actions">
          <button class="soft" :disabled="conflictDialog.loading" @click="resolveConflicts('skip')">跳过冲突项</button>
          <button class="soft" :disabled="conflictDialog.loading" @click="resolveConflicts('rename')">保留两者 (自动重命名)</button>
          <button class="warn" :disabled="conflictDialog.loading" @click="resolveConflicts('overwrite')">覆盖目标同名项</button>
          <button class="ghost" :disabled="conflictDialog.loading" @click="conflictDialog.open=false">取消</button>
        </footer>
      </section>
    </div>
    <div v-if="batchResultModal.open" class="archive-overlay" @click.self="batchResultModal.open=false">
      <section class="archive-dialog batch-result-dialog" role="dialog" aria-modal="true" :aria-label="batchResultModal.title">
        <header>
          <div><small>批量操作明细</small><h2>{{batchResultModal.title}}</h2></div>
          <button class="remove" title="关闭" @click="batchResultModal.open=false">×</button>
        </header>
        <div class="batch-result-stats">
          <span class="stat-badge stat-success">✓ 成功 {{batchResultModal.successCount}} 项</span>
          <span v-if="batchResultModal.skipCount" class="stat-badge stat-skip">⚠ 跳过 {{batchResultModal.skipCount}} 项</span>
          <span v-if="batchResultModal.failCount" class="stat-badge stat-fail">✕ 失败 {{batchResultModal.failCount}} 项</span>
        </div>
        <div class="archive-list batch-result-list">
          <div v-for="(item, idx) in batchResultModal.details" :key="idx" class="archive-row batch-result-row">
            <span>
              <i :class="['result-status-icon', item.status]">{{item.status === 'success' ? '✓' : item.status === 'skipped' ? '⚠' : '✕'}}</i>
              <b>{{item.name}}</b>
            </span>
            <em :class="['result-msg', item.status]">{{item.message}}</em>
          </div>
        </div>
        <footer class="batch-result-actions">
          <button class="primary" @click="batchResultModal.open=false">确定</button>
        </footer>
      </section>
    </div>
  </div>
</template>
