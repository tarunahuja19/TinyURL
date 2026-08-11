import { Redis } from 'ioredis';
import { env } from '../src/config/env.js';
import { getPool, closeAllPools } from '../src/db/shard_router.js';
import { resolveGeoIP } from '../src/services/geoip.js';
import { STREAM_KEY } from '../src/queue/click_producer.js';

// Dedicated Redis client instance for worker connection to avoid blocking main client
const workerRedis = new Redis(env.REDIS_URL, {
  retryStrategy: () => 1000,
  maxRetriesPerRequest: null,
  enableOfflineQueue: true
});

workerRedis.on('error', (err) => {
  console.error('[AnalyticsWorker] Redis connection error:', err.message);
});

const GROUP_NAME = 'analytics_group';
const CONSUMER_NAME = `worker_${process.pid}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 2000;

let isRunning = true;

/**
 * Helper to parse ioredis stream key-value array into a JS object
 */
function parseFields(fieldsArray) {
  const obj = {};
  for (let i = 0; i < fieldsArray.length; i += 2) {
    obj[fieldsArray[i]] = fieldsArray[i + 1];
  }
  return obj;
}

/**
 * Initializes the Redis Consumer Group if it does not already exist.
 */
async function initConsumerGroup() {
  try {
    await workerRedis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`[AnalyticsWorker] Consumer group '${GROUP_NAME}' created on stream '${STREAM_KEY}'`);
  } catch (err) {
    if (err.message.includes('BUSYGROUP')) {
      console.log(`[AnalyticsWorker] Consumer group '${GROUP_NAME}' already exists`);
    } else {
      console.error(`[AnalyticsWorker] Error creating consumer group:`, err.message);
    }
  }
}

/**
 * Batch inserts analytics records into a specific shard PostgreSQL database.
 */
async function batchInsertAnalytics(pool, records) {
  if (!records || records.length === 0) return;

  const valuePlaceholders = [];
  const params = [];
  let paramIdx = 1;

  for (const r of records) {
    valuePlaceholders.push(
      `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
    );
    params.push(
      r.shortKey,
      r.ip,
      r.country,
      r.region,
      r.city,
      r.userAgent,
      r.referrer,
      r.clickedAt
    );
    paramIdx += 8;
  }

  const sql = `
    INSERT INTO url.click_analytics
      (short_key, ip, country, region, city, user_agent, referrer, clicked_at)
    VALUES ${valuePlaceholders.join(', ')}
  `;

  await pool.query(sql, params);
}

/**
 * Processes a batch of raw Redis Stream messages.
 */
async function processBatch(messages) {
  if (!messages || messages.length === 0) return;

  const messageIds = [];
  const parsedRecords = [];

  for (const [msgId, fields] of messages) {
    messageIds.push(msgId);
    const data = parseFields(fields);

    const geo = resolveGeoIP(data.ip);
    const clickedAt = data.timestamp ? new Date(parseInt(data.timestamp, 10)) : new Date();

    parsedRecords.push({
      shortKey:  data.shortKey,
      ip:        data.ip,
      country:   geo.country,
      region:    geo.region,
      city:      geo.city,
      userAgent: data.userAgent,
      referrer:  data.referrer,
      clickedAt
    });
  }

  // Group records by target database pool (sharded by shortKey)
  const recordsByPool = new Map();
  for (const record of parsedRecords) {
    const pool = getPool(record.shortKey);
    if (!recordsByPool.has(pool)) {
      recordsByPool.set(pool, []);
    }
    recordsByPool.get(pool).push(record);
  }

  // Write to PostgreSQL in batches per shard
  for (const [pool, records] of recordsByPool.entries()) {
    await batchInsertAnalytics(pool, records);
  }

  // Acknowledge messages in Redis Stream
  await workerRedis.xack(STREAM_KEY, GROUP_NAME, ...messageIds);
  console.log(`[AnalyticsWorker] Successfully processed and ACKed ${messageIds.length} click event(s)`);
}

/**
 * Main worker consumer loop.
 */
export async function startWorker() {
  console.log(`[AnalyticsWorker] Starting worker process (${CONSUMER_NAME})...`);
  await initConsumerGroup();

  while (isRunning) {
    try {
      // Read new messages from stream for this consumer group
      const response = await workerRedis.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', BATCH_SIZE,
        'BLOCK', BLOCK_MS,
        'STREAMS', STREAM_KEY, '>'
      );

      if (response && response.length > 0) {
        const [, messages] = response[0];
        if (messages && messages.length > 0) {
          await processBatch(messages);
        }
      }
    } catch (err) {
      if (!isRunning) break;
      console.error(`[AnalyticsWorker] Error in worker loop:`, err.message);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  console.log(`[AnalyticsWorker] Worker loop stopped.`);
}

export function stopWorker() {
  isRunning = false;
  workerRedis.disconnect();
}

// Graceful shutdown handling when run directly as a standalone script
const isDirectRun = process.argv[1] && process.argv[1].endsWith('analytics_worker.js');
if (isDirectRun) {
  const shutdown = async () => {
    console.log('\n[AnalyticsWorker] Gracefully shutting down worker...');
    stopWorker();
    await closeAllPools();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  startWorker().catch((err) => {
    console.error(`[AnalyticsWorker] Fatal error:`, err);
    process.exit(1);
  });
}
