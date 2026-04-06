import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

async function ensureSeedAdminUser() {
  const seedAdminUsername = process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase();
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
  const seedAdminName = process.env.SEED_ADMIN_NAME?.trim() || "ผู้ดูแลระบบ";

  await db.user.deleteMany({ where: { email: "admin@sriwanairparts.com" } });

  if (!seedAdminUsername || !seedAdminPassword) {
    console.log(
      "Skipping admin user seed. Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD to create one."
    );
    return;
  }

if (seedAdminPassword.length < 8) {
  throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters long");
}

  const hashedPassword = await bcrypt.hash(seedAdminPassword, 12);
  const admin = await db.user.upsert({
    where: { email: seedAdminUsername },
    update: {
      name: seedAdminName,
      username: seedAdminUsername,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      name: seedAdminName,
      username: seedAdminUsername,
      email: seedAdminUsername,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Admin user ensured:", admin.email);
}

async function ensureDefaultCashBankAccounts() {
  const defaults = [
    { code: "CASH-MAIN", name: "เงินสดหน้าร้าน", type: "CASH" as const, bankName: null as string | null },
    { code: "BANK-KBANK", name: "ธนาคารกสิกรไทย", type: "BANK" as const, bankName: "Kasikornbank" },
    { code: "BANK-KTB", name: "ธนาคารกรุงไทย", type: "BANK" as const, bankName: "Krung Thai Bank" },
  ];

  const openingDate = new Date();
  openingDate.setHours(0, 0, 0, 0);

  let created = 0;
  for (const account of defaults) {
    const existing = await db.cashBankAccount.findFirst({
      where: {
        OR: [{ code: account.code }, { name: account.name }],
      },
      select: { id: true },
    });

    if (existing) {
      continue;
    }

    await db.cashBankAccount.create({
      data: {
        code: account.code,
        name: account.name,
        type: account.type,
        bankName: account.bankName,
        accountNo: null,
        openingBalance: 0,
        openingDate,
        isActive: true,
      },
    });
    created += 1;
  }

  console.log("Cash-bank defaults ensured:", created, "created");
}

async function main() {
  await ensureSeedAdminUser();
  await ensureDefaultCashBankAccounts();

  const categories = [
    "คอมเพรสเซอร์แอร์",
    "หม้อน้ำรถยนต์",
    "แผงคอนเดนเซอร์",
    "คอยล์เย็น (Evaporator)",
    "มอเตอร์พัดลม",
    "ท่อแอร์",
    "วาล์ว膨胀 (Expansion Valve)",
    "ดรายเออร์",
    "อะไหล่อื่นๆ",
  ];

  for (const name of categories) {
    await db.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log("✅ Categories:", categories.length, "รายการ");

  const carBrandsData = [
    {
      name: "Toyota",
      models: ["Camry", "Corolla", "Vios", "Yaris", "Fortuner", "Hilux Revo", "CHR", "RAV4"],
    },
    { name: "Honda", models: ["Civic", "Accord", "City", "Jazz", "HRV", "CRV", "BRV"] },
    { name: "Isuzu", models: ["D-Max", "MU-X"] },
    { name: "Mitsubishi", models: ["Triton", "Pajero Sport", "Xpander", "Attrage"] },
    { name: "Nissan", models: ["Navara", "Terra", "Almera", "Note", "March"] },
    { name: "Ford", models: ["Ranger", "Everest"] },
    { name: "Mazda", models: ["Mazda2", "Mazda3", "CX-3", "CX-5", "BT-50"] },
    { name: "Suzuki", models: ["Swift", "Ciaz", "Ertiga", "Carry"] },
    { name: "MG", models: ["MG3", "MG5", "MG ZS", "MG HS"] },
    { name: "Chevrolet", models: ["Colorado", "Trailblazer"] },
  ];

  for (const brand of carBrandsData) {
    const carBrand = await db.carBrand.upsert({
      where: { name: brand.name },
      update: {},
      create: { name: brand.name },
    });
    for (const modelName of brand.models) {
      await db.carModel.upsert({
        where: { name_carBrandId: { name: modelName, carBrandId: carBrand.id } },
        update: {},
        create: { name: modelName, carBrandId: carBrand.id },
      });
    }
  }
  console.log("✅ Car brands + models:", carBrandsData.length, "ยี่ห้อ");

  console.log("\n🎉 Seed เสร็จสมบูรณ์");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
