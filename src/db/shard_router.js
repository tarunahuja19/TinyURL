import { Pool } from 'pg';
import { env }  from '../config/env.js';
import { parseConnectionString } from './connection_helper.js';
import { dbPoolActiveGauge, dbPoolIdleGauge, dbPoolWaitingGauge } from '../observability/metrics.js';

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME        = 16777619;

function fnv1aHash(str) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

const NUM_SHARDS = parseInt(env.NUM_SHARDS ?? '2', 10);

const POOL_CONFIG = {
  max:                     10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis:       30000,
};

const shardPools = Array.from({ length: NUM_SHARDS }, (_, i) => {
  const urlKey = `DB_SHARD_${i}_URL`;
  const connectionString = env[urlKey];

  if (!connectionString) {
    throw new Error(
      `[ShardRouter] Missing env var: ${urlKey}. ` +
      `Ensure all ${NUM_SHARDS} shard URLs are configured.`
    );
  }

  const pool = new Pool({ connectionString: parseConnectionString(connectionString), ...POOL_CONFIG });

  pool.on('error', (err) => {
    console.error(`[ShardRouter] Shard ${i} pool error:`, err.message);
  });

  console.log(`[ShardRouter] Shard ${i} pool ready → ${urlKey}`);
  return pool;
});

export function collectDbPoolMetrics() {
  shardPools.forEach((pool, i) => {
    const shardName = `shard_${i}`;
    const total = pool.totalCount || 0;
    const idle = pool.idleCount || 0;
    const waiting = pool.waitingCount || 0;
    const active = Math.max(0, total - idle);

    dbPoolActiveGauge.set({ shard: shardName }, active);
    dbPoolIdleGauge.set({ shard: shardName }, idle);
    dbPoolWaitingGauge.set({ shard: shardName }, waiting);
  });
}

export function getShardIndex(shortKey) {
  return fnv1aHash(shortKey) % NUM_SHARDS;
}

export function getPool(shortKey) {
  return shardPools[getShardIndex(shortKey)];
}

export function getAllPools() {
  return shardPools;
}

export async function closeAllPools() {
  await Promise.all(shardPools.map((pool, i) => {
    console.log(`[ShardRouter] Closing shard ${i} pool...`);
    return pool.end();
  }));
}

export { NUM_SHARDS };

