import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults for local development', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      corsOrigins: [],
      databaseUrl: undefined,
      emailAdapter: 'log',
      integrationsMode: 'mock',
    });
  });

  it('parses a comma-separated origin list and treats an empty DATABASE_URL as unset', () => {
    const config = loadConfig({
      CORS_ORIGINS: 'http://localhost:5173, https://hub.example.netlify.app',
      DATABASE_URL: '  ',
      PORT: '10000',
    });
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://hub.example.netlify.app']);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.port).toBe(10000);
  });

  it('turns mock sign-in off in production unless explicitly allowed', () => {
    expect(loadConfig({}).allowMockSignIn).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', LINK_SIGNING_SECRET: 's'.repeat(32) }).allowMockSignIn).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', LINK_SIGNING_SECRET: 's'.repeat(32), ALLOW_MOCK_SIGN_IN: 'true' }).allowMockSignIn).toBe(true);
    expect(loadConfig({ ALLOW_MOCK_SIGN_IN: 'false' }).allowMockSignIn).toBe(false);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ EMAIL_ADAPTER: 'smtp' })).toThrow(/EMAIL_ADAPTER/);
  });
});
