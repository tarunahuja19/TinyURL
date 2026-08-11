import { Pool } from "pg";
import { env } from "../config/env.js";
import { parseConnectionString } from "./connection_helper.js";

export const pool = new Pool({
    connectionString: parseConnectionString(env.DATABASE_URL),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
    console.log(err.message);
});