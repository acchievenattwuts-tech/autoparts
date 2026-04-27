import { db } from "../../lib/db";

async function main() {
  const rows = await db.$queryRawUnsafe<
    {
      tgname: string;
      table_name: string;
    }[]
  >(`
    SELECT tgname, c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND tgname LIKE 'product_search_document_refresh_%'
    ORDER BY c.relname, tgname
  `);

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
