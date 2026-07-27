import { pool } from '../src/db/pool';

async function main() {
    console.log(process.env.DATABASE_URL);
  const result = await pool.query('SELECT NOW()');
  console.log('Connected:', result.rows[0]);
  await pool.end();
}

main().catch(console.error);