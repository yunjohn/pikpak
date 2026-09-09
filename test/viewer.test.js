import fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('image viewer',()=>{
  it('supports trackpad seek and volume gestures for audio',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?kind=audio&fileId=audio-1&name=song.mp3&url=https%3A%2F%2Fexample.test%2Fsong.mp3',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    const audio=dom.window.document.querySelector('audio'),shell=dom.window.document.querySelector('.audio-shell');
    Object.defineProperty(audio,'duration',{configurable:true,value:180});audio.currentTime=30;audio.volume=.5;
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:1,cancelable:true}));
    expect(audio.currentTime).toBe(40);
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:1,cancelable:true}));
    expect(audio.currentTime).toBe(40);
    await new Promise(resolve=>setTimeout(resolve,110));
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:1,deltaY:-100,cancelable:true}));
    expect(audio.volume).toBeCloseTo(.55);
    dom.window.close();
  });
  it('moves between images with buttons and arrow keys',async()=>{
    const items=Buffer.from(JSON.stringify([
      {id:'one',name:'第一张.jpg',url:'https://example.test/one.jpg'},
      {id:'two',name:'第二张.jpg',url:'https://example.test/two.jpg'},
      {id:'three',name:'第三张.jpg',url:'https://example.test/three.jpg'}
    ])).toString('base64url');
    const dom=new JSDOM('<main id="viewer"></main>',{url:`https://local.test/viewer.html?kind=image&fileId=one&name=first&url=https%3A%2F%2Fexample.test%2Fone.jpg&items=${items}`,runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.querySelector('.image-caption').textContent).toContain('1 / 3');
    expect(dom.window.document.querySelector('.image-tools').getAttribute('role')).toBe('toolbar');
    expect(dom.window.document.querySelector('.image-nav.next').getAttribute('aria-label')).toBe('下一张');
    dom.window.document.querySelector('.image-nav.next').click();
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    expect(dom.window.document.title).toBe('第二张.jpg');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft'}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/one.jpg');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'+'}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('scale(1.2)');
    expect(dom.window.document.querySelector('.image-zoom-badge').textContent).toBe('120%');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'r'}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('rotate(90deg)');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'l'}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('rotate(0deg)');
    // Test mouse drag pan
    const stage = dom.window.document.querySelector('.image-stage');
    stage.dispatchEvent(new dom.window.MouseEvent('mousedown',{button:0,clientX:100,clientY:100}));
    dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove',{clientX:150,clientY:130}));
    dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup',{}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('translate(50px, 30px)');
    // Test 0 to fit
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'0'}));
    expect(dom.window.document.querySelector('img').style.transform).toBe('translate(0px, 0px) scale(1) rotate(0deg)');
    expect(dom.window.document.querySelector('.image-zoom-badge').textContent).toBe('100%');
    const imageShell=dom.window.document.querySelector('.image-shell');
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    await new Promise(resolve=>setTimeout(resolve,110));
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/three.jpg');
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-20,ctrlKey:true,cancelable:true}));
    expect(dom.window.document.querySelector('.image-zoom-badge').textContent).toBe('120%');
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:2,deltaY:40,cancelable:true}));
    expect(dom.window.document.querySelector('.image-zoom-badge').textContent).toBe('120%');
    await new Promise(resolve=>setTimeout(resolve,70));
    const wheelUp=new dom.window.WheelEvent('wheel',{deltaY:-3,deltaMode:dom.window.WheelEvent.DOM_DELTA_LINE,cancelable:true});
    imageShell.dispatchEvent(wheelUp);
    expect(wheelUp.defaultPrevented).toBe(true);
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-3,deltaMode:dom.window.WheelEvent.DOM_DELTA_LINE,cancelable:true}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    await new Promise(resolve=>setTimeout(resolve,70));
    imageShell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:100,cancelable:true}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/three.jpg');
    dom.window.document.querySelector('[title^="开始幻灯片"]').click();
    expect(dom.window.document.querySelector('.image-tools').textContent).toContain('⏸');
    dom.window.close();
  });
  it('offers local subtitles and explicit video capture',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=test',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.HTMLMediaElement.prototype.pause=()=>{};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    dom.window.URL.createObjectURL=()=> 'blob:subtitle';
    dom.window.URL.revokeObjectURL=()=>{};
    let captured=false;
    dom.window.viewerPayload={
      get:async()=>({url:'https://example.test/movie.mp4',name:'电影.mp4',kind:'video',fileId:'movie',sources:[],items:[]}),
      chooseSubtitle:async()=>({name:'中文.srt',text:'1\n00:00:01,000 --> 00:00:02,000\n你好'}),
      capture:async()=>{captured=true;return 'shot.png'}
    };
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.querySelector('select[title="播放速度"]')).not.toBeNull();
    expect(dom.window.document.querySelector('video').controls).toBe(false);
    expect(dom.window.document.querySelector('.video-controls input[title="播放进度"]')).not.toBeNull();
    expect(dom.window.document.querySelector('video').getAttribute('aria-label')).toBe('电影.mp4 视频播放器');
    expect(dom.window.document.querySelector('.video-tools').getAttribute('role')).toBe('toolbar');
    expect(dom.window.document.querySelector('.viewer-status').getAttribute('aria-live')).toBe('polite');
    expect([...dom.window.document.querySelector('select[title="播放速度"]').options].map(option=>option.textContent)).toEqual(['0.5×','0.75×','1×','1.25×','1.5×','2×']);
    expect([...dom.window.document.querySelectorAll('.video-tools > button')].filter(button=>!button.hidden).map(button=>button.textContent)).toEqual(['字幕','画中画','外部播放器','截图']);
    dom.window.document.querySelector('.video-tools button:not([hidden])').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.querySelector('track').src).toBe('blob:subtitle');
    [...dom.window.document.querySelectorAll('.video-tools > button')].find(button=>button.textContent==='截图').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(captured).toBe(true);

    // Test delay controls
    const delayButtons = [...dom.window.document.querySelectorAll('.subtitle-delay-tools button')];
    const subtitleButton = [...dom.window.document.querySelectorAll('.video-tools > button')].find(button=>button.textContent.startsWith('字幕'));
    expect(delayButtons.map(b => b.textContent)).toEqual(['-0.5s', '+0.5s', '重置 0s']);
    delayButtons[1].click(); // +0.5s
    expect(subtitleButton.textContent).toContain('+0.5s');
    delayButtons[0].click(); // -0.5s (back to 0s)
    delayButtons[0].click(); // -0.5s (now -0.5s)
    expect(subtitleButton.textContent).toContain('-0.5s');
    delayButtons[2].click(); // reset 0s
    expect(subtitleButton.textContent).toBe('字幕：中文.srt');
    const subtitleSize=dom.window.document.querySelector('select[title="字幕字号"]'),subtitleColor=dom.window.document.querySelector('select[title="字幕颜色"]'),subtitleBackground=dom.window.document.querySelector('select[title="字幕背景"]');
    expect(subtitleSize.value).toBe('24');
    subtitleSize.value='36';subtitleSize.dispatchEvent(new dom.window.Event('change'));
    subtitleColor.value='yellow';subtitleColor.dispatchEvent(new dom.window.Event('change'));
    subtitleBackground.value='transparent';subtitleBackground.dispatchEvent(new dom.window.Event('change'));
    expect(dom.window.document.head.querySelector('style').textContent).toContain('font-size:36px');
    expect(dom.window.document.head.querySelector('style').textContent).toContain('#ffe66d');
    expect(JSON.parse(dom.window.localStorage.getItem('pikpak-viewer-video-preferences-v1'))).toMatchObject({subtitleSize:36,subtitleColor:'yellow',subtitleBackground:'transparent'});

    dom.window.close();
  });

  it('lazy-loads adjacent videos and supports optional auto play',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=playlist',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.HTMLMediaElement.prototype.pause=()=>{};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    dom.window.localStorage.setItem('pikpak-viewer-video-preferences-v1',JSON.stringify({autoNext:true}));
    const resolved=[],opened=[];
    dom.window.viewerProgress={get:async()=>({time:0,duration:0}),set:async()=>true};
    dom.window.viewerPayload={
      get:async()=>({url:'https://cdn.test/one.mp4',name:'01.mp4',kind:'video',fileId:'drive:one',sources:[{url:'https://cdn.test/one.mp4',label:'720P'}],playlist:[{fileId:'drive:one',name:'01.mp4',url:'https://cdn.test/one.mp4',sources:[{url:'https://cdn.test/one.mp4',label:'720P'}]},{fileId:'drive:two',name:'02.mp4',url:'',sources:[]}]}),
      resolveMedia:async fileId=>{resolved.push(fileId);return {url:'https://cdn.test/two.mp4',sources:[{url:'https://cdn.test/two.mp4',label:'1080P'}]}},
      openExternal:async fileId=>{opened.push(fileId);return true}
    };
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    const video=dom.window.document.querySelector('video'),next=[...dom.window.document.querySelectorAll('.video-tools button')].find(button=>button.textContent==='下一集');
    expect(next.disabled).toBe(false);
    video.dispatchEvent(new dom.window.Event('ended'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(resolved).toEqual(['drive:two']);
    expect(dom.window.document.querySelector('video').src).toBe('https://cdn.test/two.mp4');
    expect(dom.window.document.title).toBe('02.mp4');
    expect(next.disabled).toBe(true);
    [...dom.window.document.querySelectorAll('.video-tools button')].find(button=>button.textContent==='外部播放器').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(opened).toEqual(['drive:two']);
    const auto=[...dom.window.document.querySelectorAll('.video-tools button')].find(button=>button.textContent.startsWith('自动连播'));
    expect(auto.textContent).toBe('自动连播：开');
    auto.click();
    expect(auto.textContent).toBe('自动连播：关');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'PageUp'}));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.title).toBe('01.mp4');
    video.dispatchEvent(new dom.window.Event('ended'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.title).toBe('01.mp4');
    dom.window.close();
  });

  it('supports playback shortcuts and preserves position while switching quality',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=playback',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    let playCalls=0,pauseCalls=0;
    dom.window.HTMLMediaElement.prototype.pause=()=>{pauseCalls++};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>{playCalls++;return Promise.resolve()};
    dom.window.localStorage.setItem('pikpak-viewer-video-preferences-v1',JSON.stringify({rate:1.25,volume:.4,muted:true,fit:'cover'}));
    let pipCalls=0,fullscreenCalls=0;const playingStates=[];
    dom.window.HTMLVideoElement.prototype.requestPictureInPicture=async()=>{pipCalls++};
    dom.window.HTMLElement.prototype.requestFullscreen=async()=>{fullscreenCalls++};
    dom.window.viewerPlayback={setPlaying:value=>{playingStates.push(value);return Promise.resolve(playingStates.length)}};
    dom.window.viewerPayload={get:async()=>({url:'https://example.test/720.mp4',name:'电影.mp4',kind:'video',fileId:'movie',sources:[{url:'https://example.test/720.mp4',label:'720P'},{url:'https://example.test/1080.mp4',label:'1080P'}],items:[]})};
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    const video=dom.window.document.querySelector('video'),quality=dom.window.document.querySelector('select[title="清晰度"]'),speed=dom.window.document.querySelector('select[title="播放速度"]');
    expect(video.playbackRate).toBe(1.25);
    expect(video.volume).toBe(.4);
    expect(video.muted).toBe(true);
    expect(video.style.objectFit).toBe('contain');
    Object.defineProperty(video,'duration',{configurable:true,value:120});
    Object.defineProperty(video,'paused',{configurable:true,value:false});
    video.currentTime=42;video.volume=.5;
    quality.value='1';quality.dispatchEvent(new dom.window.Event('change'));
    video.dispatchEvent(new dom.window.Event('loadedmetadata'));
    expect(video.currentTime).toBe(42);
    expect(playCalls).toBeGreaterThan(0);
    speed.value='1.5';speed.dispatchEvent(new dom.window.Event('change'));
    expect(video.playbackRate).toBe(1.5);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight'}));
    expect(video.currentTime).toBe(47);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'m'}));
    expect(video.muted).toBe(false);
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'p'}));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(pipCalls).toBe(1);
    expect(dom.window.document.querySelector('select[title="画面适配"]')).toBeNull();
    video.dispatchEvent(new dom.window.Event('playing'));
    const shell=dom.window.document.querySelector('.video-shell');
    shell.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
    expect(shell.classList.contains('controls-hidden')).toBe(true);
    shell.dispatchEvent(new dom.window.MouseEvent('mousemove'));
    expect(shell.classList.contains('controls-hidden')).toBe(false);
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    expect(video.currentTime).toBe(57);
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-20,ctrlKey:true,cancelable:true}));
    expect(video.style.transform).toBe('scale(1.2)');
    expect(dom.window.document.querySelector('.video-controls').style.transform).toBe('');
    expect(dom.window.document.querySelector('.viewer-status').textContent).toBe('缩放 120%');
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:100,deltaY:2,cancelable:true}));
    expect(video.currentTime).toBe(57);
    await new Promise(resolve=>setTimeout(resolve,110));
    shell.dispatchEvent(new dom.window.WheelEvent('wheel',{deltaX:2,deltaY:-100,cancelable:true}));
    expect(video.volume).toBeCloseTo(.55);
    video.dispatchEvent(new dom.window.MouseEvent('dblclick'));
    expect(fullscreenCalls).toBe(1);
    video.dispatchEvent(new dom.window.Event('pause'));
    expect(playingStates).toEqual([true,false]);
    expect(pauseCalls).toBeGreaterThan(0);
    dom.window.close();
  });

  it('refreshes an expired media URL and reloads the video',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=refresh',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.HTMLMediaElement.prototype.pause=()=>{};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    let refreshCalls=0;
    dom.window.viewerPayload={
      get:async()=>({url:'https://cdn.test/expired.mp4',name:'长视频.mp4',kind:'video',fileId:'drive:video-id',sources:[{url:'https://cdn.test/expired.mp4',label:'原画'}]}),
      refreshMedia:async()=>{refreshCalls++;return {url:'https://cdn.test/fresh.mp4',sources:[{url:'https://cdn.test/fresh.mp4',label:'原画'}]}}
    };
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    const video=dom.window.document.querySelector('video');
    video.dispatchEvent(new dom.window.Event('error'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(refreshCalls).toBe(1);
    expect(video.src).toBe('https://cdn.test/fresh.mp4');
    dom.window.close();
  });

  it('refreshes an expired audio URL without replacing the player',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=audio-refresh',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.HTMLMediaElement.prototype.pause=()=>{};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    let refreshCalls=0;
    dom.window.viewerPayload={get:async()=>({url:'https://cdn.test/expired.mp3',name:'长音频.mp3',kind:'audio',fileId:'drive:audio-id'}),refreshMedia:async()=>{refreshCalls++;return {url:'https://cdn.test/fresh.mp3',sources:[{url:'https://cdn.test/fresh.mp3',label:'原始文件'}]}}};
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    const audio=dom.window.document.querySelector('audio');
    audio.currentTime=33;audio.dispatchEvent(new dom.window.Event('error'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(refreshCalls).toBe(1);
    expect(audio.src).toBe('https://cdn.test/fresh.mp3');
    expect(dom.window.document.querySelector('audio')).toBe(audio);
    dom.window.close();
  });

  it('offers an in-place retry after audio refresh fails',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=audio-retry',runScripts:'outside-only'});dom.window.TextDecoder=TextDecoder;dom.window.HTMLMediaElement.prototype.load=()=>{};dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();let calls=0;dom.window.viewerPayload={get:async()=>({url:'https://cdn.test/expired.mp3',name:'音频.mp3',kind:'audio',fileId:'audio-id'}),refreshMedia:async()=>{calls++;if(calls===1)throw new Error('网络断开');return {url:'https://cdn.test/recovered.mp3'}}};dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0));const audio=dom.window.document.querySelector('audio');audio.dispatchEvent(new dom.window.Event('error'));await new Promise(resolve=>setTimeout(resolve,0));const retry=dom.window.document.querySelector('.playback-retry');expect(retry.hidden).toBe(false);retry.click();await new Promise(resolve=>setTimeout(resolve,0));expect(calls).toBe(2);expect(audio.src).toBe('https://cdn.test/recovered.mp3');dom.window.close();
  });

  it('auto-loads online matched subtitles and converts ASS format',async()=>{
    const dom=new JSDOM('<main id="viewer"></main>',{url:'https://local.test/viewer.html?token=test-sub',runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.HTMLMediaElement.prototype.pause=()=>{};
    dom.window.HTMLMediaElement.prototype.load=()=>{};
    dom.window.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    let createdBlobText = '';
    dom.window.Blob = class {
      constructor(parts) { createdBlobText = parts.join(''); }
    };
    dom.window.URL.createObjectURL=()=> 'blob:online-sub';
    dom.window.URL.revokeObjectURL=()=>{};
    const assText=`[Script Info]\nTitle: Test ASS\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:23.45,0:01:26.78,Default,,0,0,0,,{\\pos(192,200)}测试字幕`;
    dom.window.fetch = async (url) => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(assText).buffer
    });
    dom.window.viewerPayload={
      get:async()=>({
        url:'https://example.test/movie.mp4',
        name:'电影.mp4',
        kind:'video',
        fileId:'movie',
        sources:[],
        items:[],
        subtitles:[{ id:'sub1', name:'电影.ass', url:'https://sub.test/movie.ass' }]
      }),
      decodeSubtitle:async bytes=>new TextDecoder().decode(bytes)
    };
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(dom.window.document.querySelector('track').src).toBe('blob:online-sub');
    expect(createdBlobText).toContain('WEBVTT');
    expect(createdBlobText).toContain('00:01:23.450 --> 00:01:26.780');
    expect(createdBlobText).toContain('测试字幕');
    dom.window.close();
  });
});
