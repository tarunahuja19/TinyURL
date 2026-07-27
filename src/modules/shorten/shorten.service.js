import {pool} from '../../db/pool.js'
export async function createShortURL(originalURL) {
    const shortkey = Math.random().toString(36).substring(2, 8);
    await pool.query(`INSERT INTO url.URL (OriginalURL,ShortURL) VALUES ($1,$2)`,[originalURL,shortkey]);

    return shortkey;
}
