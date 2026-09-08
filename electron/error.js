const code=new URLSearchParams(location.search).get('code');
document.querySelector('#error-code').textContent=code?`错误码：${code}`:'';
