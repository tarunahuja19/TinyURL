import { redis } from '../src/cache/redis_client.js';
import { STREAM_KEY } from '../src/queue/click_producer.js';

async function checkStream() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║     Redis Stream Inspector — '${STREAM_KEY}'          ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  try {
    // 1. Get Stream Length
    const len = await redis.xlen(STREAM_KEY);
    console.log(`📊 Total Messages in Stream: ${len}\n`);

    // 2. Fetch Recent Stream Entries
    console.log('📥 Recent Stream Messages (Up to 10):');
    const entries = await redis.xrange(STREAM_KEY, '-', '+', 'COUNT', 10);

    if (!entries || entries.length === 0) {
      console.log('   (Stream is currently empty)\n');
    } else {
      entries.forEach(([id, fields], idx) => {
        const parsed = {};
        for (let i = 0; i < fields.length; i += 2) {
          parsed[fields[i]] = fields[i + 1];
        }
        console.log(`   [${idx + 1}] ID: ${id}`);
        console.log(`       shortKey  : ${parsed.shortKey}`);
        console.log(`       IP        : ${parsed.ip}`);
        console.log(`       User-Agent: ${parsed.userAgent}`);
        console.log(`       Referrer  : ${parsed.referrer}`);
        console.log(`       Timestamp : ${new Date(parseInt(parsed.timestamp, 10)).toISOString()}`);
        console.log('       ────────────────────────────────────────');
      });
      console.log('');
    }

    // 3. Inspect Consumer Groups
    try {
      const groups = await redis.xinfo('GROUPS', STREAM_KEY);
      console.log('👥 Consumer Groups on Stream:');
      console.log(groups);
    } catch (gErr) {
      console.log('👥 Consumer Groups: (None created yet or stream is empty)');
    }

  } catch (err) {
    console.error('❌ Error reading Redis Stream:', err.message);
  } finally {
    redis.disconnect();
  }
}

checkStream();
