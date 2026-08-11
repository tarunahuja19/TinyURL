import { redis } from '../cache/redis_client.js';

export const STREAM_KEY = 'stream:clicks';

/**
 * Asynchronously publishes a click event to the Redis Stream.
 * Fire-and-forget execution to ensure zero blocking latency for HTTP redirects.
 */
export function emitClickEvent({ shortKey, userAgent, ip, referrer, timestamp }) {
    if (!shortKey) return;

    redis.xadd(
        STREAM_KEY,
        '*',
        'shortKey', shortKey,
        'userAgent', userAgent || '',
        'ip', ip || '',
        'referrer', referrer || '',
        'timestamp', String(timestamp || Date.now())
    ).catch((err) => {
        console.error('[AnalyticsProducer] Error pushing click event to Redis stream:', err.message);
    });
}
