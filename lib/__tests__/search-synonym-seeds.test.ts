import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();

const readSeed = (path: string) => readFileSync(join(repoRoot, path), "utf8");

test("car synonym import covers common Thai/English sub-model aliases", () => {
  const source = readSeed("scripts/import-car-search-synonyms.ts");

  for (const term of [
    "ออนิวดีแม็ก",
    "v-cross",
    "วีครอส",
    "spacecab",
    "cab4",
    "rocco",
    "ร็อคโค่",
    "vigo champ",
    "วีโก้แชมป์",
    "ไมตี้เอ็กซ์",
    "yaris ativ",
    "ฮอนด้าฟิต",
    "pro-4x",
    "คาลิเบอร์",
    "mega cab",
    "แอทลีท",
    "wildtrak",
    "แร็พเตอร์",
  ]) {
    assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("brand alias seed covers production brand spelling gaps", () => {
  const source = readSeed("scripts/seed-car-brand-aliases.ts");

  for (const term of [
    "อีซูสุ",
    "อิซูซุ",
    "นิสัน",
    "มิซูบิชิ",
    "ยูดี",
    "โฟล์คสวาเกน",
    "vw",
    "โรเว่",
  ]) {
    assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("category alias seed covers common garage vocabulary", () => {
  const source = readSeed("scripts/seed-category-aliases.ts");

  for (const term of [
    "คอยล์ตู้",
    "อีแวป",
    "หม้อน้ำแอร์",
    "วาวแอร์",
    "exp valve",
    "กรองไดเออร์",
    "มอเตอร์ตู้",
    "พัดลมคอยล์ร้อน",
    "วาล์วหางคอม",
    "สายแอร์",
    "รังผึ้งน้ำ",
    "พูลเล่ย์คอม",
  ]) {
    assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
