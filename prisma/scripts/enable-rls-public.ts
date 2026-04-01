import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

async function main() {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const { rows } = await pool.query<{
      schemaname: string;
      tablename: string;
      rowsecurity: boolean;
      forcerowsecurity: boolean;
    }>(
      `
        select
          n.nspname as schemaname,
          c.relname as tablename,
          c.relrowsecurity as rowsecurity,
          c.relforcerowsecurity as forcerowsecurity
        from pg_class c
        inner join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname
      `,
    );

    for (const row of rows) {
      await pool.query(`alter table public."${row.tablename}" enable row level security`);
    }

    const verify = await pool.query<{
      tablename: string;
      rowsecurity: boolean;
      forcerowsecurity: boolean;
    }>(
      `
        select
          c.relname as tablename,
          c.relrowsecurity as rowsecurity,
          c.relforcerowsecurity as forcerowsecurity
        from pg_class c
        inner join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname
      `,
    );

    console.log(
      JSON.stringify(
        {
          updatedTables: rows.map((row) => row.tablename),
          verify: verify.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
