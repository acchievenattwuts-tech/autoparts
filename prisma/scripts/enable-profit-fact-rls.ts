import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../lib/generated/prisma";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const tableNames = ["FactProfit"] as const;

async function main() {
  const adapter = new PrismaPg({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = new PrismaClient({
    adapter,
    log: ["error"],
  });

  try {
    await db.$executeRawUnsafe(`
      ALTER TABLE public."FactProfit" ENABLE ROW LEVEL SECURITY;
    `);

    const rows = await db.$queryRawUnsafe<
      Array<{
        tablename: string;
        rowsecurity: boolean;
        forcerowsecurity: boolean;
      }>
    >(
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
      [...tableNames],
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
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
