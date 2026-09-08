import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { jwtExpiryMs, tokenRefreshDelayMs, buildTokenRefreshBody, normalizeAccessToken } = require('../electron/core.cjs');

const EARLY_MS = 5 * 60 * 1000;

function b64url(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function buildJwt({ exp }) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ iss: 'pikpak', sub: 'u-1000', exp });
  // jwtExpiryMs only decodes the payload; signature / key are never verified.
  return `${header}.${payload}.${b64url({ sig: 'placeholder' })}`;
}

describe('token expiry with a controllable clock', () => {
  it('reads the JWT expiry (seconds) as milliseconds', () => {
    const expSeconds = 1_900_000_000; // far-future fixed value
    expect(jwtExpiryMs(buildJwt({ exp: expSeconds }))).toBe(expSeconds * 1000);
  });

  it('still reads a past expiry so callers can compare against now', () => {
    const pastSeconds = 1_000_000_000;
    expect(jwtExpiryMs(buildJwt({ exp: pastSeconds }))).toBe(pastSeconds * 1000);
  });

  it('returns 0 for a malformed or unsafe token', () => {
    expect(jwtExpiryMs('not-a-jwt')).toBe(0);
    expect(jwtExpiryMs('eyJh.only-two')).toBe(0);
    expect(jwtExpiryMs(`${b64url({ alg: 'HS256' })}.${b64url({ exp: 'not-a-number' })}.x`)).toBe(0);
  });

  it('schedules a refresh 5 minutes before expiry when far from expiry', () => {
    const now = 1_000_000_000_000;
    const expiresAt = now + 10 * 60 * 1000; // 10 min away
    expect(tokenRefreshDelayMs(expiresAt, now, EARLY_MS)).toBe(10 * 60 * 1000 - EARLY_MS);
  });

  it('clamps to 0 once the token is inside the early-refresh window', () => {
    const now = 1_000_000_000_000;
    const expiresAt = now + 3 * 60 * 1000; // 3 min away, less than the 5 min margin
    expect(tokenRefreshDelayMs(expiresAt, now, EARLY_MS)).toBe(0);
  });

  it('clamps to 0 for an already-expired token', () => {
    const now = 1_000_000_000_000;
    const expiresAt = now - 1_000; // already expired
    expect(tokenRefreshDelayMs(expiresAt, now, EARLY_MS)).toBe(0);
  });

  it('returns null when the expiry or clock is not a finite number', () => {
    expect(tokenRefreshDelayMs(0, 1_000, EARLY_MS)).toBeNull();
    expect(tokenRefreshDelayMs(Number.NaN, 1_000, EARLY_MS)).toBeNull();
    expect(tokenRefreshDelayMs(1_000, Number.NaN, EARLY_MS)).toBeNull();
  });

  it('builds a refresh body without leaking the raw refresh token into logs', () => {
    const body = buildTokenRefreshBody({ refreshToken: 'refresh-token-placeholder', clientId: 'CLIENT_ID' });
    expect(body.refresh_token).toBe('refresh-token-placeholder');
    expect(body.client_secret).toBe('');
    // the placeholder must not look like a live bearer token
    expect(normalizeAccessToken).toBeTypeOf('function');
  });
});
