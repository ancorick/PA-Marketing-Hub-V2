import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/health', () => {
  it('reports ok without a database', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'not_configured',
      email: { adapter: 'log' },
      integrations: { mode: 'mock', coreEngine: 'v1', navigatorCrm: 'v1', alumniTracker: 'v1' },
    });
  });

  it('stays 200 but reports degraded when the database is unreachable', async () => {
    app = await buildTestApp({
      database: {
        db: {} as never,
        ping: async () => {
          throw new Error('connection refused');
        },
        migrate: async () => {},
        close: async () => {},
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });
});
