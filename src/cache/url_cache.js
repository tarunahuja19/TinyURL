import { redis } from "./redis_client.js";
import { env } from "../config/env.js";
const KEY_PREFIX='url:';
export async function getCachedUrl(shortKey) {
    try {
        return await redis.get(KEY_PREFIX+shortKey);
    } catch (err) {
        console.log((err));
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