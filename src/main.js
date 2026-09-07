import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

function fatal(error) {
  const root=document.getElementById('app');if(!root)return;
  const message=String(error?.message||error||'Unknown error').replace(/[&<>]/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[value]));
  root.innerHTML=`<main style="min-height:100vh;display:grid;place-items:center;background:#f4f6fa;font-family:system-ui;color:#25304a"><section style="background:#fff;padding:36px;border-radius:16px;box-shadow:0 12px 40px #27385d18;text-align:center"><h2>界面发生错误</h2><p>请重新启动客户端。</p><small style="color:#8b94a5">${message}</small></section></main>`;
}
window.addEventListener('error',event=>fatal(event.error||event.message));
window.addEventListener('unhandledrejection',event=>fatal(event.reason));
try{createApp(App).mount('#app')}catch(error){fatal(error)}
