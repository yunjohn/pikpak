'use strict';

class ClipboardMagnetMonitor {
  constructor({ readText, findMagnet, identity, isEnabled, isAuthenticated, submit, notify, warn, detected = () => {}, initialSeen = [], remember = () => {}, now = Date.now }) {
    Object.assign(this, { readText, findMagnet, identity, isEnabled, isAuthenticated, submit, notify, warn, detected, rememberSeen:remember, now });
    this.primed = false;
    this.busy = false;
    this.seen = new Set(initialSeen);
    this.retry = null;
    this.failedUntil = new Map();
  }

  prime() {
    this.primed = true;
    this.retry = null;
  }

  remember(key) {
    this.seen.add(key);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    this.rememberSeen([...this.seen]);
  }

  async attempt(magnet, key, attempt = 1) {
    if (this.busy || !this.isEnabled() || !this.isAuthenticated()) return;
    this.busy = true;
    try {
      const task = await this.submit(magnet);
      this.remember(key);
      this.retry = null;
      this.notify({ ok: true, task });
    } catch (error) {
      this.warn(error);
      if (attempt < 3) this.retry = { magnet, key, attempt: attempt + 1, at: this.now() + 5000 * (2 ** (attempt - 1)) };
      else { this.retry = null; this.failedUntil.set(key,this.now()+300000);this.notify({ ok: false, message: '剪贴板磁力链接创建离线任务失败，稍后将允许重新尝试' }); }
    } finally { this.busy = false; }
  }

  async tick() {
    if (!this.primed) this.prime();
    if (!this.isEnabled()) return;
    if (this.retry && this.retry.at <= this.now()) {
      const pending = this.retry;
      await this.attempt(pending.magnet, pending.key, pending.attempt);
      return;
    }
    if (this.retry) return;
    let text;
    try { text = String(this.readText() || ''); } catch { return; }
    const magnet = this.findMagnet(text);
    const key = magnet ? this.identity(magnet) : '';
    if (!magnet || !key || this.seen.has(key) || (this.failedUntil.get(key)||0)>this.now() || !this.isAuthenticated()) return;
    this.detected(key);
    await this.attempt(magnet, key);
  }
}

module.exports = { ClipboardMagnetMonitor };
