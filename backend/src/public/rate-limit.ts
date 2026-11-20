import type { preHandlerAsyncHookHandler } from 'fastify';

/**
 * Fixed-window rate limit per client IP for public endpoints (NFR-S6). In-process: enough for one Render
 * instance; with several instances each counts separately, which still caps abuse per instance.
 */
export function rateLimit({ max, windowMs, now = () => Date.now() }: { max: number; windowMs: number; now?: () => number }): preHandlerAsyncHookHandler {
  const windows = new Map<string, { start: number; count: number }>();
  return async (request, reply) => {
    const time = now();
    if (windows.size > 10_000) {
      for (const [key, window] of windows) if (time - window.start >= windowMs) windows.delete(key);
    }
    const key = `${request.routeOptions.url}:${request.ip}`;
    const current = windows.get(key);
    const window = current && time - current.start < windowMs ? current : { start: time, count: 0 };
    window.count += 1;
    windows.set(key, window);
    if (window.count > max) {
      const retryAfter = Math.ceil((window.start + windowMs - time) / 1000);
      return reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({ error: 'rate_limited', message: `Too many requests; try again in ${retryAfter} seconds` });
    }
  };
}
