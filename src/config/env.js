import dotenv from 'dotenv';
dotenv.config();

export const env = {
  PORT:              parseInt(process.env.SERVER_PORT || process.env.PORT || '3000', 10),
  DATABASE_URL:      process.env.DATABASE_URL,
  DB_PASSWORD:       process.env.DB_PASSWORD,
  REDIS_URL:         process.env.REDIS_URL,
  CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
  MACHINE_ID:        parseInt(process.env.MACHINE_ID ?? '0', 10),
  NUM_SHARDS:        parseInt(process.env.NUM_SHARDS ?? '2', 10),
  DB_SHARD_0_URL:    process.env.DB_SHARD_0_URL,
  DB_SHARD_1_URL:    process.env.DB_SHARD_1_URL,
};
