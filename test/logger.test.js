import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { Logger, sanitizeValue, sanitizeText } = require('../electron/logger.cjs');

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

  it('redacts cookies, account identifiers, signed URLs, and embedded bearer values', () => {
    const raw = {
      cookie: 'session=private-cookie',
      email: 'person@example.test',
      phoneNumber: '+8613812345678',
      downloadUrl: 'https://cdn.test/file?signature=signed-value&x-oss-security-token=sts-value&safe=yes',
      message: 'request failed: Bearer abc.def.ghi'
    };

    const sanitized = sanitizeValue('', raw);
    expect(sanitized.cookie).toContain('***');
    expect(sanitized.email).toContain('***');
    expect(sanitized.phoneNumber).toContain('***');
    expect(sanitized.downloadUrl).toContain('signature=[REDACTED]');
    expect(sanitized.downloadUrl).toContain('x-oss-security-token=[REDACTED]');
    expect(sanitized.downloadUrl).toContain('safe=yes');
    expect(sanitized.message).toBe('request failed: Bearer [REDACTED]');
    expect(sanitizeText('https://api.test/?refresh_token=secret&name=visible')).toBe('https://api.test/?refresh_token=[REDACTED]&name=visible');
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

  it('records sanitized crash reports and persists them to the crash directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikpak-crash-'));
    const logInstance = new Logger();
    logInstance.init(dir);

    const report = logInstance.recordCrash({
      type: 'renderer', reason: 'crashed', exitCode: 5,
      stack: 'Error: boom\nBearer abc.def.ghi\n    at https://cdn.test/file?access_token=secret123456',
      appVersion: '0.55.9'
    });

    expect(report.type).toBe('renderer');
    expect(report.exitCode).toBe(5);
    expect(report.reason).toBe('crashed');
    expect(report.stack).toContain('access_token=[REDACTED]');
    expect(report.stack).toContain('Bearer [REDACTED]');
    expect(report.stack).not.toContain('secret123456');

    const crashFiles = fs.readdirSync(logInstance.crashDir).filter(file => file.endsWith('.json'));
    expect(crashFiles).toHaveLength(1);
    const onDisk = fs.readFileSync(path.join(logInstance.crashDir, crashFiles[0]), 'utf8');
    expect(onDisk).not.toContain('secret123456');
    expect(JSON.parse(onDisk).id).toBe(report.id);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includes recent crash reports in the diagnostics export', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikpak-crash-'));
    const logInstance = new Logger();
    logInstance.init(dir);

    logInstance.recordCrash({ type: 'child', reason: 'died', exitCode: 9, processType: 'GPU', stack: 'gpu stack', appVersion: '0.55.9' });
    logInstance.warn('app', 'some warning');

    const report = logInstance.buildDiagnostics({ appVersion: '0.55.9' });
    expect(report.crashReports.length).toBeGreaterThanOrEqual(1);
    expect(report.crashReports[0].type).toBe('child');
    expect(report.crashReports[0].processType).toBe('GPU');
    expect(report.crashReports[0].appVersion).toBe('0.55.9');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
