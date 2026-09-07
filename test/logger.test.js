import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { Logger, sanitizeValue } = require('../electron/logger.cjs');

describe('logger and diagnostics', () => {
  it('sanitizes sensitive keys and bearer tokens', () => {
    const raw = {
      accessToken: 'secret_token_123456789',
      authorization: 'Bearer secret_value_here',
      password: 'mypassword123',
      pass_code: '4321',
      normalField: 'hello world',
      nested: {
        security_token: 'aliyun_sts_secret',
        url: 'https://example.test/s/123?access_token=token123&pass_code=8888'
      }
    };

    const sanitized = sanitizeValue('', raw);
    expect(sanitized.accessToken).not.toBe('secret_token_123456789');
    expect(sanitized.accessToken).toContain('***');
    expect(sanitized.authorization).toBe('Bearer [REDACTED]');
    expect(sanitized.password).toContain('***');
    expect(sanitized.pass_code).toBe('***');
    expect(sanitized.normalField).toBe('hello world');
    expect(sanitized.nested.security_token).toContain('***');
    expect(sanitized.nested.url).toContain('access_token=[REDACTED]');
    expect(sanitized.nested.url).toContain('pass_code=[REDACTED]');
  });

  it('records structured entries in ring buffer', () => {
    const logInstance = new Logger({ maxMemoryLogs: 5 });
    for (let i = 0; i < 10; i++) {
      logInstance.info('test', `message ${i}`, { index: i, token: `secret${i}` });
    }

    const recent = logInstance.getRecentLogs(10);
    expect(recent).toHaveLength(5);
    expect(recent[4].message).toBe('message 9');
    expect(recent[4].data.token).toContain('***');
    expect(recent[4].level).toBe('INFO');
  });

  it('builds diagnostic report without revealing credentials', () => {
    const logInstance = new Logger();
    logInstance.warn('auth', 'Refresh failed', { attempt: 1 });

    const report = logInstance.buildDiagnostics({
      appVersion: '0.34.0',
      account: { connected: true, accessToken: 'super_secret', source: 'web-login' },
      settings: { downloadDirectory: 'C:\\Downloads', downloadConcurrency: 3 },
      transferStats: { activeDownloads: 1, queuedDownloads: 2 }
    });

    expect(report.appName).toBe('PikPak Desktop');
    expect(report.appVersion).toBe('0.34.0');
    expect(report.system.platform).toBe(process.platform);
    expect(report.account.accessToken).toContain('***');
    expect(report.account.source).toBe('web-login');
    expect(report.transferStats.activeDownloads).toBe(1);
    expect(report.recentLogs.length).toBeGreaterThanOrEqual(1);
  });
});
