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
    const [tablesResult, sensitiveColumnsResult, policiesResult] = await Promise.all([
      pool.query(
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
      ),
      pool.query(
        `
          select
            table_name,
            column_name,
            data_type
          from information_schema.columns
          where table_schema = 'public'
            and column_name in (
              'password',
              'email',
              'phone',
              'taxId',
              'shippingAddress',
              'address'
            )
          order by table_name, column_name
        `,
      ),
      pool.query(
        `
          select
            schemaname,
            tablename,
            policyname,
            permissive,
            roles,
            cmd
          from pg_policies
          where schemaname = 'public'
          order by tablename, policyname
        `,
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          tables: tablesResult.rows,
          sensitiveColumns: sensitiveColumnsResult.rows,
          policies: policiesResult.rows,
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
