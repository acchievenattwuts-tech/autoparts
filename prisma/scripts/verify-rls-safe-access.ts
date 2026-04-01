import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

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
    const [userCount, productCount, siteContentCount] = await Promise.all([
      db.user.count(),
      db.product.count(),
      db.siteContent.count(),
    ]);

    console.log(
      JSON.stringify(
        {
          ok: true,
          userCount,
          productCount,
          siteContentCount,
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
