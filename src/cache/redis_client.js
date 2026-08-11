import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
    retryStrategy: () => 1000,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true
});
redis.on('error', (err) => {
    console.log(err.message);
});