import { checkRateLimit } from '../rate-limit/rate_limiter.js';

export function rateLimit(options) {
  return async function (req, reply) {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    const key = `ratelimit:${options.name}:${clientIp}`;

    const result = await checkRateLimit(key, options.windowSeconds, options.limit);

    reply.header('X-RateLimit-Limit', options.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfterSeconds);
      return reply.status(429).send({ error: 'Too many requests, slow down.' });
    }
  };
}