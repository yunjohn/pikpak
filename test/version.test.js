import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { compareVersions, isUpdateAvailable } = require('../electron/core.cjs');

describe('version comparison for update gating', () => {
  it('compares simple dotted versions numerically', () => {
    expect(compareVersions('0.55.13', '0.55.9')).toBe(1);
    expect(compareVersions('0.55.9', '0.55.13')).toBe(-1);
    expect(compareVersions('0.55.13', '0.55.13')).toBe(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.55.10', '0.55.2')).toBe(1);
  });

  it('tolerates a leading v, missing/padded segments, and a trailing suffix', () => {
    expect(compareVersions('v0.55.13', '0.55.9')).toBe(1);
    expect(compareVersions('0.55', '0.55.0')).toBe(0);
    expect(compareVersions('0.55.1', '0.55')).toBe(1);
    expect(compareVersions('0.55.13.1', '0.55.13')).toBe(1);
    // a non-numeric suffix on the final segment does not change the version
    expect(compareVersions('0.55.13-beta', '0.55.13')).toBe(0);
  });

  it('reports an update only when the remote is strictly newer', () => {
    expect(isUpdateAvailable('0.55.9', '0.55.13')).toBe(true);
    expect(isUpdateAvailable('0.55.13', '0.55.9')).toBe(false);
    expect(isUpdateAvailable('0.55.13', '0.55.13')).toBe(false);
  });
});
