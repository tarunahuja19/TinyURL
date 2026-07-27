import {pool} from '../../db/pool.js'
export async function getOriginalUrl(shortkey) {
    const {rows}=await pool.query(`SELECT OriginalURL FROM url.URL WHERE ShortURL = $1 AND (expires_at IS NULL OR expires_at > now())`,[shortkey]);
    return rows[0]?.originalurl ?? null
}