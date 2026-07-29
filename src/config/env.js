import dotenv from 'dotenv';
dotenv.config();

export const env = {
  PORT: parseInt(process.env.SERVER_PORT || process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL,
  DB_PASSWORD:process.env.DB_PASSWORD,
  REDIS_URL:process.env.REDIS_URL,
  CACHE_TTL_SECONDS:process.env.CACHE_TTL_SECONDS
};
