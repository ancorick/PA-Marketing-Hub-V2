import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, FRONTEND_ORIGIN } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CORS', () => {
  it('allows the configured frontend origin', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: { origin: FRONTEND_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers to other origins', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
