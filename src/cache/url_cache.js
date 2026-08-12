import { redis } from "./redis_client.js";
import { env } from "../config/env.js";
import { redisCacheHitsCounter, redisCacheMissesCounter } from "../observability/metrics.js";

const KEY_PREFIX = 'url:';

export async function getCachedUrl(shortKey) {
    try {
        const val = await redis.get(KEY_PREFIX + shortKey);
        if (val) {
            redisCacheHitsCounter.inc();
        } else {
            redisCacheMissesCounter.inc();
        }
        return val;
    } catch (err) {
        console.error('[UrlCache] Error fetching cached URL:', err.message);
        redisCacheMissesCounter.inc();
        return null;
    }
}
export async function setCachedUrl(shortKey,originalUrl) {
    try {
        await redis.set(KEY_PREFIX+shortKey,originalUrl,'EX',env.CACHE_TTL_SECONDS);
    } catch (error) {
        console.log((error));
        
    }
}