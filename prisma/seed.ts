import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

async function main() {
  // Admin user
  const hashedPassword = await bcrypt.hash("admin1234", 12);
  const admin = await db.user.upsert({
    where: { email: "admin@sriwanairparts.com" },
    update: {},
    create: {
      name: "ผู้ดูแลระบบ",
      email: "admin@sriwanairparts.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  });
  console.log("✅ Admin user:", admin.email);

  // Categories
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

  // Car brands
  const carBrandsData = [
    { name: "Toyota", models: ["Camry", "Corolla", "Vios", "Yaris", "Fortuner", "Hilux Revo", "CHR", "RAV4"] },
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
  console.log("📧 Email: admin@sriwanairparts.com");
  console.log("🔑 Password: admin1234");
  console.log("⚠️  กรุณาเปลี่ยนรหัสผ่านหลัง login ครั้งแรก");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
