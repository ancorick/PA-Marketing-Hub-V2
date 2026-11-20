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

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ EMAIL_ADAPTER: 'smtp' })).toThrow(/EMAIL_ADAPTER/);
  });
});
