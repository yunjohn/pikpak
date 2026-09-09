import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource=fs.readFileSync(path.resolve('src/App.vue'),'utf8');
const mainSource=fs.readFileSync(path.resolve('electron/main.cjs'),'utf8');
const preloadSource=fs.readFileSync(path.resolve('electron/preload.cjs'),'utf8');
const indexSource=fs.readFileSync(path.resolve('index.html'),'utf8');
const errorPageSource=fs.readFileSync(path.resolve('electron/error.html'),'utf8');
const smokeSource=fs.readFileSync(path.resolve('scripts/smoke.cjs'),'utf8');
const packageWinSource=fs.readFileSync(path.resolve('scripts/package-win.cjs'),'utf8');
const packageJson=JSON.parse(fs.readFileSync(path.resolve('package.json'),'utf8'));

describe('file manager layout',()=>{
  it('keeps file actions out of the top toolbar',()=>{
    const toolbar=appSource.slice(appSource.indexOf('<header class="toolbar">'),appSource.indexOf('<section v-if="mode===\'external-search\'"'));
    expect(toolbar).not.toContain('downloadSelected');
    expect(toolbar).not.toContain('createShareSelected');
    expect(toolbar).not.toContain('trashSelected');
  });

  it('renders contextual actions inside the file list and has no directory tree component',()=>{
    const panelStart=appSource.indexOf('ref="filePanelEl"');
    const batchStart=appSource.indexOf('class="batch-toolbar"');
    const rowsStart=appSource.indexOf('v-for="item in displayFiles"');
    expect(panelStart).toBeGreaterThan(-1);
    expect(rowsStart).toBeGreaterThan(panelStart);
    expect(batchStart).toBeGreaterThan(rowsStart);
    expect(appSource).not.toContain('FolderTree');
    expect(appSource).not.toContain('treeExpanded');
  });

  it('uses a single application instance and resolves downloaded files by task id',()=>{
    expect(mainSource).toContain('app.requestSingleInstanceLock()');
    expect(mainSource).toContain("app.on('second-instance'");
    expect(preloadSource).toContain("showDownload: id => ipcRenderer.invoke('download:show', id)");
    expect(appSource).toContain('api.showDownload(task.id)');
    expect(mainSource).toContain("task.state!=='completed'");
  });

  it('isolates smoke tests from the real user profile',()=>{
    expect(smokeSource).toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'pikpak-desktop-smoke-'))");
    expect(smokeSource).toContain('PIKPAK_SMOKE_USER_DATA: smokeUserData');
    expect(smokeSource).toContain('`release-${version}-win`');
    expect(smokeSource).toContain('fs.rmSync(smokeUserData, { recursive: true, force: true })');
    expect(mainSource).toContain("app.setPath('userData', path.resolve(process.env.PIKPAK_SMOKE_USER_DATA))");
  });

  it('reuses the installed Electron runtime for Windows when available',()=>{
    expect(packageJson.scripts['package:win']).toContain('node scripts/package-win.cjs');
    expect(packageWinSource).toContain('const outputDirectory = `release-${appVersion}-win`');
    expect(packageWinSource).toContain('`--config.directories.output=${outputDirectory}`');
    expect(packageWinSource).toContain("fs.existsSync(electronDist)");
    expect(packageWinSource).toContain('`--config.electronDist=${electronDist}`');
    expect(packageWinSource).toContain('function cachedElectronDirectory()');
    expect(packageWinSource).toContain('`electron-v${electronVersion}-win32-${process.arch}.zip`');
    expect(packageWinSource).toContain('`--config.electronDist=${cachedElectron}`');
    expect(packageWinSource).toContain('downloading through electron-builder');
  });

  it('sandboxes the main renderer and blocks untrusted navigation',()=>{
    expect(mainSource).toContain("preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true");
    expect(mainSource).toContain("win.webContents.on('will-navigate'");
    expect(mainSource).toContain("return {action:'deny'}");
  });

  it('searches u9a9 through a bounded native external-search page',()=>{
    expect(appSource).toContain('外部搜索');
    expect(preloadSource).toContain("external-search:search");
    expect(mainSource).toContain("target.searchParams.set('type','2')");
    expect(mainSource).toContain("target.searchParams.set('search',keyword)");
    expect(mainSource).toContain('net.fetch(target.toString()');
    expect(mainSource).toContain("ipcMain.handle('external-search:search'");
    expect(mainSource).not.toContain("partition:'persist:external-search'");
    expect(appSource).toContain('externalMagnetSummary(result.magnet)');
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.external-search-panel\{[^}]*overflow:hidden/);
    expect(styleSource).toMatch(/\.external-search-panel\{[^}]*max-height:calc\(100vh - 120px\)/);
    expect(styleSource).toMatch(/\.external-results\{[^}]*overflow-y:auto/);
    expect(styleSource).toMatch(/\.external-result b\{[^}]*-webkit-line-clamp:2/);
  });

  it('uses a packaged CSP-protected fallback instead of interpolated error HTML',()=>{
    expect(mainSource).toContain("win.loadFile(path.join(__dirname,'error.html')");
    expect(mainSource).toContain('if(!isMainFrame||showingFallbackError)return');
    expect(mainSource).not.toContain("loadURL('data:text/html");
    expect(errorPageSource).toContain('Content-Security-Policy');
    expect(errorPageSource).not.toContain('${description}');
  });

  it('applies a restrictive CSP and denies permissions in local UI sessions',()=>{
    expect(indexSource).toContain('Content-Security-Policy');
    expect(indexSource).toContain("default-src 'none'");
    expect(indexSource).toContain("script-src 'self'");
    expect(mainSource).toContain('function restrictLocalSessionPermissions(targetSession)');
    expect(mainSource).toContain('setPermissionCheckHandler(()=>false)');
    expect(mainSource).toContain('setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false))');
    expect(mainSource).toContain('restrictLocalSessionPermissions(session.defaultSession)');
  });

  it('supports large image directories without the old 60-item viewer cap',()=>{
    expect(appSource).toContain("filter(isImage).slice(0,5000)");
    expect(mainSource).toContain("safeItems=(Array.isArray(items)?items:[]).slice(0,5000)");
    expect(appSource).not.toContain('all.length-60');
  });

  it('supports native macOS application bundles as external players',()=>{
    expect(mainSource).toContain("process.platform==='darwin'&&stat.isDirectory()&&/\\.app$/i.test(filePath)");
    expect(mainSource).toContain("path.join(filePath,'Contents','MacOS')");
    expect(appSource).toContain("appInfo.platform==='darwin'?'VLC、IINA 或 mpv'");
    expect(appSource).toContain('选择程序');
  });

  it('keeps offline task state synchronized while its page is visible',()=>{
    expect(mainSource).toContain("if(pageToken)query.set('page_token',pageToken)");
    expect(appSource).toContain("mode.value==='transfers'&&account.value.connected&&!document.hidden");
    expect(appSource).toContain('clearInterval(offlinePollTimer)');
  });

  it('combines upload, local download, and offline tasks in one transfer center',()=>{
    expect(appSource).toContain("mode.value==='transfers'?'传输中心'");
    expect(appSource).toContain('class="transfer-center"');
    expect(appSource).toContain('⇧ 上传任务');
    expect(appSource).toContain('⇩ 本机下载');
    expect(appSource).toContain('⚡ 离线下载');
    expect(appSource).not.toContain("mode==='uploads'");
    expect(appSource).not.toContain("mode==='downloads'");
    expect(appSource).not.toContain("mode==='offline'");
    expect(appSource).not.toContain('loadOffline');
  });

  it('prevents cancelled or superseded searches from replacing newer results',()=>{
    expect(appSource).toContain('let searchGeneration=0');
    expect(appSource).toContain('const generation=++searchGeneration');
    expect(appSource).toContain('if(generation!==searchGeneration||!isCurrent())return');
    expect(appSource).toContain('async function cancelSearch(){searchGeneration++');
  });

  it('highlights search terms as escaped Vue text in names and paths',()=>{
    expect(appSource).toContain('function highlightedParts(value)');
    expect(appSource).toContain('highlightedParts(item.name)');
    expect(appSource).toContain("highlightedParts(item._search_path||item.mime_type||item.kind)");
    expect(appSource).not.toContain('v-html');
  });

  it('uses complete non-trashed directory listings and never caches false-negative empty searches',()=>{
    expect(mainSource).toContain('SEARCH_CACHE_TTL=2*60*1000');
    expect(mainSource).toContain('SEARCH_CACHE_LIMIT=10');
    expect(mainSource).toContain('return {...cached.result,cached:true}');
    expect(mainSource).toContain("with_audit:'true'");
    expect(mainSource).toContain("phase:{eq:'PHASE_TYPE_COMPLETE'}");
    expect(mainSource).toContain("trashed:{eq:false}");
    expect(mainSource).toContain('if(!truncated&&matches.length){searchCache.set(query');
    expect(mainSource).toContain('if(isDriveFolder(item)&&item.id&&!visited.has(item.id))');
    expect(mainSource).toContain('clearSearchCache();');
  });

  it('supports macOS trackpad navigation without browser overscroll',()=>{
    expect(appSource).toContain("appInfo.value.platform!=='darwin'");
    expect(appSource).toContain("window.addEventListener('wheel',handleTrackpadNavigation,{passive:false})");
    expect(appSource).toContain('navigateCrumb(pathStack.value.length-2)');
    expect(appSource).toContain('trackpadBackLocked=true');
    expect(appSource).toContain('const TRACKPAD_GESTURE_GAP_MS=90');
    expect(appSource).toContain('if(pathStack.value.length<2){trackpadBackDistance=0;trackpadBackLocked=true;return}');
    expect(appSource).toContain('trackpadNavigating=true');
  });

  it('offers file and folder properties in the current list context',()=>{
    expect(appSource).toContain("contextAction('properties')");
    expect(appSource).toContain('class="archive-dialog properties-dialog"');
    expect(appSource).toContain('创建时间');
    expect(appSource).toContain('分辨率');
  });

  it('provides a desktop-style contextual file menu',()=>{
    expect(appSource).toContain('@contextmenu.prevent.stop="showContextMenu(item,$event)"');
    expect(appSource).toContain('class="context-menu"');
    expect(appSource).toContain("window.addEventListener('blur',closeContextMenu)");
    expect(appSource).toContain("contextAction('properties')");
  });

  it('removes the per-row operation buttons and the 操作 column header',()=>{
    expect(appSource).not.toContain('class="row-actions"');
    expect(appSource).not.toContain("itemAction(item,'properties')");
    const headStart=appSource.indexOf('class="list-head"');
    const headEnd=appSource.indexOf('</div>',headStart);
    expect(appSource.slice(headStart,headEnd)).not.toContain('操作');
    // operations stay available through the context menu and the batch toolbar
    expect(appSource).toContain("contextAction('download')");
    expect(appSource).toContain("contextAction('star')");
    expect(appSource).toContain("contextAction('share')");
    expect(appSource).toContain('class="batch-toolbar"');
    expect(appSource).toContain('@dblclick="openItem(item)"');
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).not.toMatch(/\.row-actions\{/);
    expect(styleSource).toMatch(/\.list-head,\.file-row\{[^}]*grid-template-columns:[^}]*135px[^}]*\}/);
  });

  it('confirms destructive actions through a styled dialog instead of a native prompt',()=>{
    expect(appSource).not.toContain('window.confirm');
    expect(appSource).toContain('function confirmAction(');
    expect(appSource).toContain('function resolveConfirm(');
    expect(appSource).toContain('class="archive-dialog confirm-dialog"');
    expect(appSource).toContain('class="confirm-body"');
    expect(appSource).toContain('resolveConfirm(true)');
    expect(appSource).toContain("confirmDialog.danger?'危险操作':'确认操作'");
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.confirm-dialog\{/);
    expect(styleSource).toMatch(/\.confirm-body\{/);
  });

  it('uses a non-blocking input dialog for names and archive passwords',()=>{
    expect(appSource).not.toContain('window.prompt');
    expect(appSource).toContain('function promptAction(');
    expect(appSource).toContain('function resolvePrompt(');
    expect(appSource).toContain('class="archive-dialog input-dialog"');
    expect(appSource).toContain('@submit.prevent="resolvePrompt(true)"');
    expect(appSource).toContain("type:'password',confirmLabel:'解锁'");
    expect(appSource).toContain("title:'新建文件夹'");
    expect(appSource).toContain("title:'重命名'");
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.input-overlay\{z-index:140\}/);
  });

  it('unifies empty, loading and retryable error state tones',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.state,\.transfer-empty,\.archive-state,\.offline-state\{[^}]*color:/);
    expect(styleSource).toMatch(/\.state\.error,\.transfer-empty\.error,\.archive-state\.error,\.offline-state\.error\{[^}]*color:/);
  });

  it('refreshes the sidebar task count after adding an external result',()=>{
    const start=appSource.indexOf('async function addExternal(result)');
    const end=appSource.indexOf('function externalMagnetSummary',start);
    const implementation=appSource.slice(start,end);
    expect(implementation).toContain('await api.addExternalMagnet(result.magnet)');
    expect(implementation).toContain('await refreshOfflineTasks()');
    expect(implementation.indexOf('await refreshOfflineTasks()')).toBeGreaterThan(implementation.indexOf('await api.addExternalMagnet'));
    expect(appSource).toContain('{{uploads.length+downloads.length+offlineTasks.length}}');
  });

  it('keeps search pages focused and uses a shared compact layout',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(appSource).toContain("mode.value==='external-search'?'外部搜索'");
    const toolbar=appSource.slice(appSource.indexOf('<header class="toolbar">'),appSource.indexOf('</header>')+9);
    expect(toolbar).not.toContain('@click="showShareStart"');
    expect(appSource).toContain('<button :class="{active:mode===\'share\'}" @click="showShareStart"');
    expect(appSource).toContain(`v-if="mode==='search'" class="toolbar-description"`);
    expect(appSource).toContain(`v-else-if="mode==='external-search'" class="toolbar-description"`);
    expect(appSource).toContain('class="search-page-intro"');
    expect(appSource).toContain(':disabled="loading||globalQuery.trim().length<2"');
    expect(appSource).toContain(':disabled="loading||externalQuery.trim().length<2"');
    expect(styleSource).toMatch(/\.search-all-panel\{[^}]*width:min\(680px/);
    expect(styleSource).toMatch(/\.external-search-head,\.external-results\{[^}]*width:min\(980px/);
  });

  it('offers recovery for expired sessions and failed file-list loads',()=>{
    expect(mainSource).toContain("setAuthState('retryable-error','登录状态已过期，请重新连接 PikPak')");
    expect(appSource).toContain('class="state state-retry error"');
    expect(appSource).toContain('@click="refreshCurrent">重试</button>');
  });

  it('disables account-only library navigation until an account is connected',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    for(const page of ['starred','recent','myshares','trash']){
      expect(appSource).toContain(`:class="{active:mode==='${page}'}" :disabled="!account.connected"`);
    }
    expect(styleSource).toMatch(/\.sidebar nav button:disabled\{[^}]*cursor:not-allowed/);
  });

  it('keeps full search accessible and explains the login requirement',()=>{
    expect(appSource).toContain(`:class="{active:mode==='search'}" title="全盘搜索" @click="showSearchPage"`);
    expect(appSource).not.toContain(`:class="{active:mode==='search'}" :disabled="!account.connected"`);
    expect(appSource).toContain("account.connected?'搜索整个 PikPak':'连接账户后使用全盘搜索'");
    expect(appSource).toContain('class="primary search-login" :disabled="loading" @click="webLogin"');
    expect(appSource).toContain("error.value='全盘搜索至少输入 2 个字符'");
    expect(appSource).toContain("searchStats.value=null;error.value='';pathStack.value");
  });

  it('prevents duplicate refresh and login actions while work is pending',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(appSource).toContain('class="account-card" :disabled="loading"');
    expect(appSource).toContain("{{loading?'正在处理…':account.connected?'账户已连接 · 退出':'网页登录 PikPak'}}");
    expect(appSource.match(/class="soft" :disabled="loading" @click="(?:refreshCurrent|loadStarred|loadRecent|loadMyShares|loadTrash|refreshOfflineTasks)"/g)).toHaveLength(6);
    expect(styleSource).toMatch(/\.primary:disabled,\.soft:disabled,\.account-card:disabled\{[^}]*cursor:not-allowed/);
  });

  it('shows the generic refresh action only on refreshable file pages',()=>{
    expect(appSource).toContain(`v-if="(mode==='drive'&&account.connected)||(mode==='share'&&share)" class="soft" :disabled="loading" @click="refreshCurrent"`);
    expect(appSource).not.toContain(`v-if="!['transfers','trash','starred','recent','myshares'].includes(mode)" class="soft"`);
  });

  it('keeps existing rows visible during refresh and shows compact feedback',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(appSource).toContain('v-if="loading&&!files.length" class="state"');
    expect(appSource).toContain('v-if="loading&&files.length" class="list-feedback"');
    expect(appSource).toContain('v-else-if="error&&files.length" class="list-feedback error"');
    expect(styleSource).toMatch(/\.list-feedback\{[^}]*position:sticky/);
    expect(styleSource).toContain('html[data-resolved-theme="dark"] .list-feedback');
  });

  it('exposes file operations and asynchronous states to assistive technology',()=>{
    expect(appSource).toContain('aria-label="搜索当前目录"');
    expect(appSource).toContain('role="region" :aria-label="`${title}文件列表`"');
    expect(appSource).toContain(':aria-pressed="selectedIds.includes(item.id)');
    expect(appSource).toContain('role="toolbar" :aria-label="`已选择 ${selectedItems.length} 项的批量操作`"');
    expect(appSource).toContain('aria-label="下载所选项目"');
    expect(appSource).toContain('class="state state-retry error" role="alert"');
    expect(appSource).toContain('class="notice" role="status" aria-live="polite"');
  });

  it('persists light, dark, and system appearance modes',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(mainSource).toContain("['system','light','dark'].includes(value.theme)");
    expect(appSource).toContain('v-model="settings.theme"');
    expect(appSource).toContain("window.matchMedia?.('(prefers-color-scheme: dark)')");
    expect(appSource).toContain('document.documentElement.dataset.resolvedTheme=resolved');
    expect(appSource).toContain("themeMedia?.addEventListener?.('change',handleSystemThemeChange)");
    expect(appSource).toContain("themeMedia?.removeEventListener?.('change',handleSystemThemeChange)");
    expect(styleSource).toContain('html[data-resolved-theme="dark"] .file-row');
    expect(styleSource).toContain('html[data-resolved-theme="dark"] .archive-dialog');
  });

  it('provides a localized desktop menu without reloading the SPA',()=>{
    expect(mainSource).toContain('Menu.setApplicationMenu(Menu.buildFromTemplate(template))');
    expect(mainSource).toContain("accelerator:'CmdOrCtrl+,'");
    expect(mainSource).toContain("sendMenuCommand('refresh')");
    expect(mainSource).toContain("sendMenuCommand('transfers')");
    expect(mainSource).toContain("sendMenuCommand('settings')");
    expect(preloadSource).toContain("ipcRenderer.on('menu:command',listener)");
    expect(appSource).toContain('function handleMenuCommand(command)');
    expect(appSource).toContain("if(mode.value==='starred'){loadStarred();return}");
    expect(appSource).toContain('removeMenuCommandListener();');
    expect(mainSource).not.toContain("sendMenuCommand('reload')");
  });

  it('restores cached sections and keeps the macOS main window alive',()=>{
    expect(appSource).toContain('const viewCache=new Map()');
    expect(appSource).toContain("restoreCachedView(cacheKey,'drive')");
    expect(appSource).toContain("@click=\"loadDrive('','全部文件','reset',true)\"");
    expect(appSource).toContain('@click="loadStarred(true)"');
    expect(appSource).toContain('@click="loadRecent(true)"');
    expect(appSource).toContain('@click="loadTrash(true)"');
    expect(appSource).toContain('viewCache.clear();resetNavigationState()');
    expect(mainSource).toContain("process.platform==='darwin'&&!isQuitting");
    expect(mainSource).toContain('event.preventDefault();win.hide()');
    expect(mainSource).toContain('else{mainWindow.show();mainWindow.focus()}');
    expect(mainSource).toContain("app.on('before-quit',()=>{isQuitting=true");
  });

  it('prevents slower section requests from overwriting the active page',()=>{
    expect(appSource).toContain('let pageRequestGeneration=0');
    expect(appSource).toContain('const generation=++pageRequestGeneration');
    expect(appSource).toContain('const isCurrent=()=>generation===pageRequestGeneration');
    expect(appSource).toContain('if(!isCurrent())return;');
    expect(appSource).toContain('await runPage(async isCurrent=>');
    expect(appSource).toContain('function showSearchPage(){invalidatePageRequest()');
    expect(appSource).toContain('function showSettings(){invalidatePageRequest()');
    expect(appSource).toContain('function showShareStart(){invalidatePageRequest()');
    expect(appSource).toContain('generation!==searchGeneration||!isCurrent()');
  });

  it('captures renderer and child crashes and includes them in diagnostics',()=>{
    expect(mainSource).toContain("process.on('uncaughtExceptionMonitor'");
    expect(mainSource).not.toContain("process.on('uncaughtException',");
    expect(mainSource).toContain("app.on('render-process-gone'");
    expect(mainSource).toContain("app.on('child-process-gone'");
    expect(mainSource).toContain("logger.recordCrash(");
    const loggerSource=fs.readFileSync(path.resolve('electron/logger.cjs'),'utf8');
    expect(loggerSource).toContain('recordCrash(details');
    expect(loggerSource).toContain('this.crashDir');
    expect(loggerSource).toContain('crashReports: this.crashReports(10)');
    expect(loggerSource).toMatch(/fs\.writeFileSync\(path\.join\(this\.crashDir/);
  });

  it('never passes sentinel breadcrumb ids (starred/recent/...) as real drive parents',()=>{
    expect(appSource).toContain("const SENTINEL_IDS=new Set(['starred','recent','trash','myshares','search'])");
    expect(appSource).toContain('function isSentinelId(');
    expect(appSource).toContain('function loadSentinelPage(');
    expect(appSource).toContain("if(isSentinelId(target.id)){loadSentinelPage(target.id);return}");
    expect(appSource).toContain('isSentinelId(parentId)');
    expect(appSource).toContain("if(value==='starred')return loadStarred();");
    expect(appSource).toContain("if(value==='recent')return loadRecent();");
    // drive:list returns a notFound marker instead of a raw "File or folder is not found" throw
    expect(mainSource).toContain('notFound: true');
    expect(mainSource).toContain('err.fileNotFound');
    expect(mainSource).toContain('isFileNotFound(err.status, err.data)');
    expect(mainSource).toContain('Skipped a folder that is no longer available');
  });

  it('keeps the documented large-list caps so listing/search/preview stay bounded',()=>{
    // whole-drive search caps
    expect(mainSource).toContain('visited.size<5000');
    expect(mainSource).toContain('scanned<50000');
    expect(mainSource).toContain('matches.length<500');
    // image viewer pagination cap
    expect(appSource).toContain('slice(0,5000)');
    expect(mainSource).toContain('slice(0,5000)');
    // lazy file-list rendering
    expect(appSource).toContain('renderedLimit');
    expect(appSource).toContain('slice(0,renderedLimit');
  });

  it('enriches offline tasks with the shared status model without guessing new actions',()=>{
    // main enriches every offline task with _state from the tested core model
    expect(mainSource).toContain('_state:offlineTaskState(task)');
    expect(mainSource).toContain("require('./core.cjs')");
    // renderer prefers the enriched _state for label/percent and falls back to raw phase
    expect(appSource).toContain('if(task._state?.label)return task._state.label');
    expect(appSource).toContain('if(task._state&&Number.isFinite(task._state.percent))return task._state.percent');
    // we do NOT wire speculative pause/resume/retry IPC
    expect(preloadSource).not.toContain("offlineRetry");
    expect(preloadSource).not.toContain("offlinePause");
    expect(preloadSource).not.toContain("offlineResume");
    // main imports the shared offline model/action-builder from core
    expect(mainSource).toContain('buildOfflineTaskAction');
    expect(mainSource).toContain('offlineTaskState');
    // the offline panel only shows "正在加载…" when there are no tasks yet, so a
    // refresh after deleting a task does not double-render loading text with the list
    expect(appSource).toContain('v-if="loading&&!offlineTasks.length"');
    // transfer grid keeps each section content-sized (no stretch)
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.transfer-center\{[^}]*align-items:\s*start/);
    expect(styleSource).toMatch(/\.offline-row \.download-info\{[^}]*flex-direction:\s*column/);
  });

  it('monitors the clipboard for magnet links and auto-starts an offline download',()=>{
    // main: reads clipboard, detects magnet, submits an offline task, notifies the renderer
    expect(mainSource).toContain('findMagnetLink');
    expect(mainSource).toContain('clipboard.readText()');
    expect(mainSource).toContain("clipboardMagnetTick");
    expect(mainSource).toContain('ClipboardMagnetMonitor');
    expect(mainSource).toContain("driveMutation('/drive/v1/files'");
    expect(mainSource).toContain("webContents.send('offline:clipboard'");
    expect(mainSource).toContain('settings.clipboardMagnet');
    // preload: renderer subscribes to the clipboard event
    expect(preloadSource).toContain("onOfflineClipboard");
    expect(preloadSource).toContain("ipcRenderer.on('offline:clipboard'");
    // renderer: subscribes, refreshes offline list, and surfaces a notice; settings carry the toggle
    expect(appSource).toContain("api.onOfflineClipboard(");
    expect(appSource).toContain('clipboardMagnet:true');
    expect(appSource).toContain('剪贴板磁力链自动离线下载');
    expect(appSource).toContain('settings.clipboardMagnet');
  });

  it('sorts file names with a natural-order collator instead of raw string comparison',()=>{
    expect(appSource).toContain("new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'})");
    expect(appSource).toContain('nameCollator.compare(av,bv)');
    expect(appSource).not.toContain("localeCompare(bv,'zh-CN')");
    const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
    const names=['1','10','11','16','17','1岁','2','21','24','24岁','25','3','张三'];
    const sorted=[...names].sort((a,b)=>collator.compare(a,b));
    expect(sorted).toEqual(['1','1岁','2','3','10','11','16','17','21','24','24岁','25','张三']);
  });

  it('locks file row text from being selected on double-click',()=>{
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.file-row[^}]*user-select:\s*none/);
    expect(styleSource).toMatch(/\.file-row \*,[^}]*user-select:\s*none|\.file-row\.file-row \*[^}]*user-select/);
  });

  it('makes the row checkbox a real interactive button with explicit toggle',()=>{
    expect(appSource).toMatch(/<button type="button" class="row-check" role="checkbox"/);
    expect(appSource).toMatch(/row-check[^>]*@click\.stop="toggleSelect\(item,\$event\)"/);
    expect(appSource).toContain("@dblclick.stop");
    expect(appSource).toContain("toggleSelect(item,$event)");
  });

  it('removes the header-level select-all checkbox and keeps sort controls',()=>{
    expect(appSource).not.toContain('class="head-check"');
    expect(appSource).not.toContain('toggleSelectAll');
    expect(appSource).not.toContain('allSelected');
    expect(appSource).not.toContain('someSelected');
    expect(appSource).toContain("setSort('name')");
    expect(appSource).toContain("setSort('size')");
    expect(appSource).toContain("setSort('time')");
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).not.toMatch(/\.head-check\{/);
  });

  it('supports shift range selection with a persistent anchor index',()=>{
    expect(appSource).toContain("lastClickedIndex");
    expect(appSource).toMatch(/event\?\.shiftKey&&lastClickedIndex\.value>=0/);
  });

  it('preserves multi-selection when triggering row or context menu actions',()=>{
    expect(appSource).toMatch(/selectedIds\.value\.includes\(item\.id\)&&selectedIds\.value\.length>1/);
    expect(appSource).toMatch(/showContextMenu\(item,event\)\{if\(!selectedIds\.value\.includes\(item\.id\)\)/);
  });

  it('rejects single-file operations with a clear message when multiple items are selected',()=>{
    expect(appSource).toContain('重命名仅支持单个文件');
    expect(appSource).toContain('预览仅支持单个文件');
    expect(appSource).toContain('复制链接仅支持单个分享');
  });

  it('constrains batch operations to currently visible files and prunes hidden selection',()=>{
    expect(appSource).toContain('visibleFiles.value.filter(item=>selectedIds.value.includes(item.id))');
    expect(appSource).toMatch(/selectedIds\.value\.some\(id=>!visibleIds\.has\(id\)\)/);
    expect(appSource).toContain('v-if="selectedItems.length>0" class="batch-toolbar"');
  });

  it('marks the anchor row distinctly from plain selection',()=>{
    expect(appSource).toContain("anchor:selected?.id===item.id");
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.file-row\.anchor\{/);
  });

  it('renders a floating icon batch toolbar at the bottom when items are selected',()=>{
    expect(appSource).toContain('class="batch-toolbar"');
    expect(appSource).toContain('batch-sep');
    expect(appSource).toMatch(/v-if="selectedItems\.length>0".*class="batch-toolbar"|class="batch-toolbar".*v-if="selectedItems\.length>0"/);
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.batch-toolbar\{[^}]*position:\s*absolute/);
    expect(styleSource).toMatch(/\.batch-toolbar\{[^}]*bottom:/);
    expect(styleSource).toMatch(/\.batch-sep\{/);
  });

  it('exposes svg icons through symbols and use references, not v-html',()=>{
    expect(appSource).toContain('<symbol id="bk-share"');
    expect(appSource).toContain('<symbol id="bk-trash"');
    expect(appSource).toMatch(/<svg class="batch-icon"><use href="#bk-/);
    expect(appSource).not.toContain('v-html');
  });

  it('supports mouse drag box selection with a live rectangle overlay',()=>{
    expect(appSource).toContain('function onFilePanelMouseDown(');
    expect(appSource).toContain('function onBoxMouseMove(');
    expect(appSource).toContain('function onBoxMouseUp(');
    expect(appSource).toContain('function applyBoxSelection(');
    expect(appSource).toContain('boxSelectStyle');
    expect(appSource).toContain('@mousedown="onFilePanelMouseDown"');
    expect(appSource).toContain('class="box-select"');
    expect(appSource).toContain('data-id="item.id"');
    expect(appSource).toMatch(/window\.addEventListener\('mousemove',onBoxMouseMove\)/);
    expect(appSource).toMatch(/window\.addEventListener\('mouseup',onBoxMouseUp\)/);
    const styleSource=fs.readFileSync(path.resolve('src/style.css'),'utf8');
    expect(styleSource).toMatch(/\.box-select\{[^}]*pointer-events:\s*none/);
  });
});
