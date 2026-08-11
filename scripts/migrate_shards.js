import { Pool } from 'pg';
import dotenv from 'dotenv';
import { parseConnectionString } from '../src/db/connection_helper.js';

dotenv.config();

const CREATE_SCHEMA = `CREATE SCHEMA IF NOT EXISTS url;`;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS url.URL (
    ID          BIGINT    PRIMARY KEY,
    OriginalURL TEXT      NOT NULL,
    ShortURL    TEXT      NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    expires_at  TIMESTAMP
);
`.trim();

const CREATE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_short_url
    ON url.URL (ShortURL);
`.trim();

const CREATE_ANALYTICS_TABLE = `
CREATE TABLE IF NOT EXISTS url.click_analytics (
    id         BIGSERIAL PRIMARY KEY,
    short_key  TEXT NOT NULL,
    ip         TEXT,
    country    VARCHAR(10),
    region     VARCHAR(100),
    city       VARCHAR(100),
    user_agent TEXT,
    referrer   TEXT,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim();

const CREATE_ANALYTICS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_click_analytics_short_key ON url.click_analytics (short_key);
CREATE INDEX IF NOT EXISTS idx_click_analytics_clicked_at ON url.click_analytics (clicked_at);
`.trim();

async function migrateOneShard(shardIndex, connectionString) {
  const safeConnectionString = parseConnectionString(connectionString);
  console.log(`\n[Migrate] ── Shard ${shardIndex} ──────────────────────────────`);
  console.log(`[Migrate] Connecting to: ${connectionString.replace(/:([^:@]+)@/, ':***@')}`);

  const pool = new Pool({ connectionString: safeConnectionString, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();

  try {
    console.log(`[Migrate] Running CREATE SCHEMA...`);
    await client.query(CREATE_SCHEMA);
    console.log(`[Migrate] ✓ Schema ready`);

    console.log(`[Migrate] Running CREATE TABLE (url.URL)...`);
    await client.query(CREATE_TABLE);
    console.log(`[Migrate] ✓ Table url.URL ready`);

    console.log(`[Migrate] Running CREATE INDEX (url.URL)...`);
    await client.query(CREATE_INDEX);
    console.log(`[Migrate] ✓ Index idx_urls_short_url ready`);

    console.log(`[Migrate] Running CREATE TABLE (url.click_analytics)...`);
    await client.query(CREATE_ANALYTICS_TABLE);
    console.log(`[Migrate] ✓ Table url.click_analytics ready`);

    console.log(`[Migrate] Running CREATE INDEX (url.click_analytics)...`);
    await client.query(CREATE_ANALYTICS_INDEXES);
    console.log(`[Migrate] ✓ Indexes on url.click_analytics ready`);

    const { rows } = await client.query(`SELECT COUNT(*) AS count FROM url.URL`);
    console.log(`[Migrate] ✓ Shard ${shardIndex} verified — ${rows[0].count} rows`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const NUM_SHARDS = parseInt(process.env.NUM_SHARDS ?? '2', 10);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║       TinyURL — Phase 4 Shard Migration              ║');
  console.log(`║       Migrating ${NUM_SHARDS} shard(s)                          ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  const shardUrls = Array.from({ length: NUM_SHARDS }, (_, i) => {
    const url = process.env[`DB_SHARD_${i}_URL`];
    if (!url) {
      throw new Error(
        `Missing env var DB_SHARD_${i}_URL. ` +
        `Make sure .env has all ${NUM_SHARDS} shard URLs.`
      );
    }
    return url;
  });

  const results = await Promise.allSettled(
    shardUrls.map((url, i) => migrateOneShard(i, url))
  );

  console.log('\n[Migrate] ── Summary ─────────────────────────────────────');
  let hasError = false;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[Migrate] ✅  Shard ${i}: OK`);
    } else {
      console.error(`[Migrate] ❌  Shard ${i}: FAILED — ${result.reason?.message || result.reason}`);
      if (result.reason?.stack) console.error(result.reason.stack);
      hasError = true;
    }
  });

  if (hasError) {
    console.error('\n[Migrate] ⚠️  Some shards failed. Fix errors and re-run.');
    process.exit(1);
  } else {
    console.log('\n[Migrate] 🎉  All shards migrated successfully.');
    console.log('[Migrate] You can now start the server: npm run dev');
  }
}

main().catch((err) => {
  console.error('[Migrate] Fatal error:', err.message);
  process.exit(1);
});
