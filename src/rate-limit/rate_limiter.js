import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redis } from '../cache/redis_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const script = fs.readFileSync(
  path.join(__dirname, 'sliding_window_counter.lua'),
  'utf-8'
);

export async function checkRateLimit(key, windowSeconds, limit) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const [remaining, retryAfter] = await redis.eval(
      script,
      1,
      key,
      now,
      windowSeconds,
      limit
    );

    return {
      allowed: retryAfter === 0,
      remaining,
      retryAfterSeconds: retryAfter
    };
  } catch (err) {

    console.error('Rate limiter Redis error, failing open:', err.message);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}