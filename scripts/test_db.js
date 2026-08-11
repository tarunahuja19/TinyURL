import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function testConn(url, label) {
  if (!url) {
    console.log(`[SKIP] ${label}: No URL specified`);
    return;
  }
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT current_database(), version()');
    console.log(`[SUCCESS] ${label}: Connected to DB '${res.rows[0].current_database}'`);
    client.release();
  } catch (err) {
    console.error(`[FAILED] ${label}: ${err.message}`);
  } finally {
    await pool.end();
  }
}

async function run() {
  await testConn(process.env.DATABASE_URL, 'DATABASE_URL (5432)');
  await testConn(process.env.DB_SHARD_0_URL, 'DB_SHARD_0_URL (5434)');
  await testConn(process.env.DB_SHARD_1_URL, 'DB_SHARD_1_URL (5435)');
}

run();
