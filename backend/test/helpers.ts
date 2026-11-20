import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { Database } from '../src/db/client.js';

export const FRONTEND_ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: FRONTEND_ORIGIN, ...overrides });
}

export function buildTestApp(options: { database?: Database } = {}) {
  return buildApp({ config: testConfig(), ...options });
}
