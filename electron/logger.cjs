const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SENSITIVE_KEYS = new Set([
  'token', 'access_token', 'accesstoken', 'authorization', 'auth',
  'password', 'passwd', 'pass_code', 'passcode', 'secret',
  'security_token', 'access_key_secret', 'refresh_token'
]);

function sanitizeValue(key, value, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  const lowerKey = String(key || '').toLowerCase().replace(/[-_]/g, '');

  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value)) {
      return 'Bearer [REDACTED]';
    }
    if (value.includes('access_token=') || value.includes('pass_code=')) {
      value = value.replace(/(access_token|pass_code)=([^&]+)/gi, '$1=[REDACTED]');
    }
  }

  for (const sensitive of SENSITIVE_KEYS) {
    if (lowerKey.includes(sensitive.replace(/[-_]/g, ''))) {
      if (typeof value === 'string' && value.length > 0) {
        return value.length > 8 ? `${value.slice(0, 3)}***${value.slice(-3)}` : '***';
      }
      return '[REDACTED]';
    }
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(index, item, depth + 1));
  }

  if (typeof value === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(value)) {
      clean[k] = sanitizeValue(k, v, depth + 1);
    }
    return clean;
  }

  return value;
}

class Logger {
  constructor(options = {}) {
    this.logsDir = options.logsDir || '';
    this.maxMemoryLogs = options.maxMemoryLogs || 200;
    this.memoryLogs = [];
    this.maxFileSize = 5 * 1024 * 1024; // 5MB
    this.filePath = '';
  }

  init(userDataPath) {
    if (userDataPath) {
      this.logsDir = path.join(userDataPath, 'logs');
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
        this.filePath = path.join(this.logsDir, 'app.log');
      } catch {}
    }
  }

  log(level, category, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: String(level || 'info').toUpperCase(),
      category: String(category || 'app'),
      message: String(message || ''),
      data: data !== null && data !== undefined ? sanitizeValue('', data) : undefined
    };

    this.memoryLogs.push(entry);
    if (this.memoryLogs.length > this.maxMemoryLogs) {
      this.memoryLogs.shift();
    }

    if (this.filePath) {
      try {
        const line = JSON.stringify(entry) + '\n';
        if (fs.existsSync(this.filePath)) {
          const stats = fs.statSync(this.filePath);
          if (stats.size > this.maxFileSize) {
            const oldPath = path.join(this.logsDir, 'app.old.log');
            try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
            try { fs.renameSync(this.filePath, oldPath); } catch {}
          }
        }
        fs.appendFileSync(this.filePath, line, 'utf8');
      } catch {}
    }

    return entry;
  }

  info(category, message, data) { return this.log('INFO', category, message, data); }
  warn(category, message, data) { return this.log('WARN', category, message, data); }
  error(category, message, data) { return this.log('ERROR', category, message, data); }
  debug(category, message, data) { return this.log('DEBUG', category, message, data); }

  getRecentLogs(limit = 100) {
    return this.memoryLogs.slice(-Math.max(1, Math.min(limit, this.maxMemoryLogs)));
  }

  buildDiagnostics(extra = {}) {
    return {
      appName: 'PikPak Desktop',
      appVersion: extra.appVersion || '0.34.0',
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        totalMemory: Math.round(os.totalmem() / (1024 * 1024)),
        freeMemory: Math.round(os.freemem() / (1024 * 1024)),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome
      },
      account: sanitizeValue('', extra.account || {}),
      settings: sanitizeValue('', extra.settings || {}),
      transferStats: extra.transferStats || {},
      recentLogs: this.getRecentLogs(100)
    };
  }
}

const logger = new Logger();

module.exports = {
  Logger,
  logger,
  sanitizeValue
};
