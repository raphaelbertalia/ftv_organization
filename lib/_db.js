import { Pool } from "pg";

const globalForDb = globalThis;

export const pool =
  globalForDb.__quartaChPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (!globalForDb.__quartaChPool) {
  globalForDb.__quartaChPool = pool;
}