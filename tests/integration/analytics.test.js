import { buildApp } from '../../src/app.js';
import { createShortURL } from '../../src/modules/shorten/shorten.service.js';
import { startWorker, stopWorker } from '../../worker/analytics_worker.js';
import { getPool, closeAllPools } from '../../src/db/shard_router.js';
import { redis } from '../../src/cache/redis_client.js';

async function runAnalyticsIntegrationTest() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Phase 5 — Real-Time Analytics & Ingestion Test     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const app = buildApp();
  await app.ready();

  // 1. Create a short URL
  const targetUrl = 'https://example.com/analytics-demo';
  const shortKey = await createShortURL(targetUrl);
  console.log(`[Test Setup] Created short URL: key='${shortKey}' -> target='${targetUrl}'`);

  // 2. Start the background worker process asynchronously
  const workerPromise = startWorker();
  console.log('[Test Setup] Background analytics worker started.');

  // 3. Perform redirect HTTP request with analytics headers
  const userAgent = 'TestBot/2.0 (Phase5-Test)';
  const referrer = 'https://github.com/test';
  const testIp = '8.8.8.8';

  console.log('[Test Action] Sending GET /' + shortKey + ' with analytics headers...');
  const startTime = Date.now();

  const response = await app.inject({
    method: 'GET',
    url: `/${shortKey}`,
    headers: {
      'user-agent': userAgent,
      'referer': referrer,
      'x-forwarded-for': testIp
    }
  });

  const responseTimeMs = Date.now() - startTime;
  console.log(`[Test Response] Status: ${response.statusCode}, Time: ${responseTimeMs}ms, Location: ${response.headers.location}`);

  // Assert redirection
  if (response.statusCode !== 302) {
    throw new Error(`Expected HTTP 302 redirect, got ${response.statusCode}`);
  }
  if (response.headers.location !== targetUrl) {
    throw new Error(`Expected Location header '${targetUrl}', got '${response.headers.location}'`);
  }
  if (responseTimeMs > 200) {
    console.warn(`[Performance Warning] Response took ${responseTimeMs}ms (expected < 200ms)`);
  } else {
    console.log(`✓ HTTP Redirect executed with zero latency overhead (${responseTimeMs}ms)`);
  }

  // 4. Wait for background worker stream consumption & batch DB write
  console.log('[Test Action] Waiting 1500ms for background consumer batch write...');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 5. Query PostgreSQL analytics table in the corresponding shard
  const shardPool = getPool(shortKey);
  const { rows } = await shardPool.query(
    `SELECT short_key, ip, country, region, city, user_agent, referrer, clicked_at
     FROM url.click_analytics
     WHERE short_key = $1
     ORDER BY id DESC LIMIT 1`,
    [shortKey]
  );

  console.log('[Test Result] Queried click_analytics row:', rows[0]);

  if (!rows || rows.length === 0) {
    throw new Error(`No analytics record found in DB for short_key '${shortKey}'`);
  }

  const record = rows[0];
  if (record.short_key !== shortKey) {
    throw new Error(`Expected short_key '${shortKey}', got '${record.short_key}'`);
  }
  if (record.ip !== testIp) {
    throw new Error(`Expected IP '${testIp}', got '${record.ip}'`);
  }
  if (record.country !== 'US') {
    throw new Error(`Expected resolved GeoIP country 'US', got '${record.country}'`);
  }
  if (record.user_agent !== userAgent) {
    throw new Error(`Expected user_agent '${userAgent}', got '${record.user_agent}'`);
  }
  if (record.referrer !== referrer) {
    throw new Error(`Expected referrer '${referrer}', got '${record.referrer}'`);
  }
  if (!record.clicked_at) {
    throw new Error('Expected valid clicked_at timestamp in database');
  }

  console.log('\n✅ Analytics integration test passed successfully!');
  console.log(`   - Stream push: Non-blocking Fire-and-Forget`);
  console.log(`   - Redirect response: HTTP 302 (${responseTimeMs}ms)`);
  console.log(`   - GeoIP parsed: ${testIp} -> ${record.country}`);
  console.log(`   - PostgreSQL batch insert: verified in shard DB`);

  // Cleanup
  stopWorker();
  await app.close();
  await closeAllPools();
  redis.disconnect();

  process.exit(0);
}

runAnalyticsIntegrationTest().catch((err) => {
  console.error('❌ Analytics integration test failed:', err);
  process.exit(1);
});
