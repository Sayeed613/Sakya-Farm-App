import { describe, expect, it } from 'vitest';

import { validateEnvironment } from '../src/config/env.validation';

const validEnvironment: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/sakya_farms',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('validateEnvironment', () => {
  it('fills in defaults for optional variables', () => {
    const env = validateEnvironment({ ...validEnvironment });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:8081',
      'http://localhost:19006',
      'http://localhost:3001',
    ]);
  });

  it('coerces numeric and boolean values out of their string form', () => {
    const env = validateEnvironment({
      ...validEnvironment,
      PORT: '8080',
      TRUST_PROXY: 'true',
      THROTTLE_LIMIT: '250',
    });

    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.THROTTLE_LIMIT).toBe(250);
  });

  it('treats "false" as false rather than as a truthy string', () => {
    // The bug this guards against: Boolean('false') === true.
    expect(validateEnvironment({ ...validEnvironment, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(
      false,
    );
    expect(validateEnvironment({ ...validEnvironment, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(false);
  });

  it('splits, trims and drops empty entries from a list variable', () => {
    const env = validateEnvironment({
      ...validEnvironment,
      CORS_ORIGINS: 'http://a.test, http://b.test ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_SECRET: validEnvironment.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: validEnvironment.JWT_REFRESH_SECRET,
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('fails when DATABASE_URL is not a PostgreSQL connection string', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/postgresql/);
  });

  it('fails when a JWT secret is too short to be safe', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/at least 32 characters/);
  });

  it('reports every problem at once instead of one per run', () => {
    try {
      validateEnvironment({ PORT: 'not-a-port' });
      throw new Error('Expected validation to fail');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('PORT');
    }
  });

  it('refuses placeholder secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'replace-with-a-long-random-string-for-access-tokens',
      }),
    ).toThrow(/placeholder/);
  });

  it('refuses identical access and refresh secrets in production', () => {
    const shared = 'c'.repeat(48);

    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      }),
    ).toThrow(/must differ/);
  });
});
