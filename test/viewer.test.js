import fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('image viewer',()=>{
  it('moves between images with buttons and arrow keys',async()=>{
    const items=Buffer.from(JSON.stringify([
      {id:'one',name:'第一张.jpg',url:'https://example.test/one.jpg'},
      {id:'two',name:'第二张.jpg',url:'https://example.test/two.jpg'}
    ])).toString('base64url');
    const dom=new JSDOM('<main id="viewer"></main>',{url:`https://local.test/viewer.html?kind=image&fileId=one&name=first&url=https%3A%2F%2Fexample.test%2Fone.jpg&items=${items}`,runScripts:'outside-only'});
    dom.window.TextDecoder=TextDecoder;
    dom.window.eval(fs.readFileSync(new URL('../electron/viewer.js',import.meta.url),'utf8'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.querySelector('.image-caption').textContent).toContain('1 / 2');
    dom.window.document.querySelector('.image-nav.next').click();
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/two.jpg');
    expect(dom.window.document.title).toBe('第二张.jpg');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft'}));
    expect(dom.window.document.querySelector('img').src).toBe('https://example.test/one.jpg');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'+'}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('scale(1.2)');
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'r'}));
    expect(dom.window.document.querySelector('img').style.transform).toContain('rotate(90deg)');
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
    expect([...dom.window.document.querySelectorAll('.video-tools button')].map(button=>button.textContent)).toEqual(['字幕','截图']);
    dom.window.document.querySelector('.video-tools button').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(dom.window.document.querySelector('track').src).toBe('blob:subtitle');
    dom.window.document.querySelectorAll('.video-tools button')[1].click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(captured).toBe(true);
    dom.window.close();
  });
});
