import { getAllPools, closeAllPools } from '../src/db/shard_router.js';

async function checkAnalyticsDB() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     PostgreSQL Analytics Shards Inspector            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const pools = getAllPools();

  try {
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      console.log(`🗄️  ── SHARD ${i} Database ─────────────────────────────────`);

      const countRes = await pool.query('SELECT COUNT(*) AS total FROM url.click_analytics');
      const totalRows = countRes.rows[0].total;
      console.log(`   Total Analytics Rows: ${totalRows}\n`);

      if (parseInt(totalRows, 10) > 0) {
        const { rows } = await pool.query(
          `SELECT id, short_key, ip, country, region, city, user_agent, referrer, clicked_at
           FROM url.click_analytics
           ORDER BY id DESC
           LIMIT 5`
        );

        rows.forEach((r, idx) => {
          console.log(`   [Row ${idx + 1}] ID: ${r.id}`);
          console.log(`       shortKey  : ${r.short_key}`);
          console.log(`       IP        : ${r.ip}`);
          console.log(`       Location  : ${r.country} / ${r.region} / ${r.city}`);
          console.log(`       User-Agent: ${r.user_agent}`);
          console.log(`       Referrer  : ${r.referrer}`);
          console.log(`       Clicked At: ${r.clicked_at ? new Date(r.clicked_at).toISOString() : 'N/A'}`);
          console.log('       ────────────────────────────────────────');
        });
      } else {
        console.log('   (No click analytics rows in this shard yet)\n');
      }
    }
  } catch (err) {
    console.error('❌ Error querying analytics table:', err.message);
  } finally {
    await closeAllPools();
  }
}

checkAnalyticsDB();
