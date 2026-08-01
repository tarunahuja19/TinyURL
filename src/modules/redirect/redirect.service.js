import { getPool }                   from '../../db/shard_router.js';
import { getCachedUrl, setCachedUrl } from '../../cache/url_cache.js';
import { singleFlight }               from '../../cache/single_flight.js';

export async function fetchData(shortKey) {
    const pool = getPool(shortKey);
    const { rows } = await pool.query(
        `SELECT OriginalURL
         FROM   url.URL
         WHERE  ShortURL = $1
           AND  (expires_at IS NULL OR expires_at > now())`,
        [shortKey]
    );
    return rows[0]?.originalurl ?? null;
}

export async function getOriginalUrl(shortKey) {
    const cached = await getCachedUrl(shortKey);
    if (cached) return cached;

    const originalUrl = await singleFlight(shortKey, () => fetchData(shortKey));
    if (originalUrl) {
        await setCachedUrl(shortKey, originalUrl);
    }

    return originalUrl;
}