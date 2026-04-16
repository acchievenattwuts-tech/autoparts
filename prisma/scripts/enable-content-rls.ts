import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const tableNames = [
  "ContentPost",
  "ContentApproval",
  "ContentScheduledJob",
  "ContentAuditLog",
] as const;

const sql = `
ALTER TABLE public."ContentPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentScheduledJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ContentAuditLog" ENABLE ROW LEVEL SECURITY;
`;

async function main() {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await pool.query(sql);

    const { rows } = await pool.query<{
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
          and c.relname = any($1::text[])
        order by c.relname
      `,
      [tableNames],
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          tables: rows,
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
