import { snowflake } from '../../id-generation/snowflake.js';
import { encode }     from '../../id-generation/base62.js';
import { getPool }    from '../../db/shard_router.js';
import { setCachedUrl } from '../../cache/url_cache.js';

export async function createShortURL(originalURL) {
    const rawId    = snowflake.nextRawId();
    const shortKey = encode(rawId);
    const pool     = getPool(shortKey);

    await pool.query(
        `INSERT INTO url.URL (ID, OriginalURL, ShortURL) VALUES ($1, $2, $3)`,
        [rawId, originalURL, shortKey]
    );
    await setCachedUrl(shortKey, originalURL);

    return shortKey;
}
