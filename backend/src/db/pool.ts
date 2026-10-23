import pg from "pg";

export function createPool(config: { DATABASE_URL: string }): pg.Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    options: "-c search_path=dna_work,public",
  });
}
