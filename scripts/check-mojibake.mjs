/**
 * check-mojibake.mjs — blocks UTF-8 -> Windows-1252 double-encoded Thai text
 * (Thai strings corrupted into "a-grave + superscript" gibberish sequences)
 * from entering the repo. See .rules "Thai text must never be corrupted".
 *
 * Usage:
 *   node scripts/check-mojibake.mjs --staged   # pre-commit: scan staged blobs
 *   node scripts/check-mojibake.mjs            # scan all tracked text files
 *
 * The detection pattern is built from numeric code points so this file
 * contains no mojibake-looking literals and can never trip its own check.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".css", ".prisma", ".sql", ".txt", ".yml", ".yaml", ".html",
]);

// Double-encoded tell-tale sequences:
//  - U+00E0 + U+00B8/U+00B9 -> Thai codepoints re-read as cp1252
//  - U+00E2 + cp1252-special -> punctuation / box-drawing re-read as cp1252
//  - U+FFFD                  -> replacement char: the file already lost bytes
const chars = (...codes) => String.fromCharCode(...codes);

// The 27 cp1252 characters mapped into 0x80-0x9F (euro, curly quotes, dashes,
// ellipsis, dagger, trademark, etc.) — these follow U+00E2 in double-encoded text.
const CP1252_SPECIALS = chars(
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
);

const MOJIBAKE_PATTERN = new RegExp(
  chars(0xe0) + "[" + chars(0xb8, 0xb9) + "]" +
    "|" + chars(0xe2) + "[" + CP1252_SPECIALS + "]" +
    "|" + chars(0xfffd),
);

const isTextFile = (path) => {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
};

const git = (args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });

const stagedMode = process.argv.includes("--staged");

const listFiles = () => {
  const args = stagedMode
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"]
    : ["ls-files", "-z"];
  return git(args).toString("utf8").split("\0").filter(Boolean).filter(isTextFile);
};

const readContent = (path) =>
  stagedMode
    ? git(["show", `:${path}`]).toString("utf8") // staged blob, not the working copy
    : readFileSync(path, "utf8");

const findings = [];
for (const path of listFiles()) {
  let content;
  try {
    content = readContent(path);
  } catch {
    continue; // deleted/renamed race or unreadable — not this guard's problem
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (MOJIBAKE_PATTERN.test(lines[i])) {
      findings.push({ path, line: i + 1, excerpt: lines[i].trim().slice(0, 80) });
    }
  }
}

if (findings.length > 0) {
  console.error("");
  console.error("❌ พบภาษาไทยเพี้ยน (mojibake / double-encoded UTF-8):");
  console.error("");
  for (const f of findings.slice(0, 20)) {
    console.error(`  ${f.path}:${f.line}  ${f.excerpt}`);
  }
  if (findings.length > 20) {
    console.error(`  ...และอีก ${findings.length - 20} จุด`);
  }
  console.error("");
  console.error("สาเหตุที่พบบ่อย: editor เปิดไฟล์เป็น Windows-1252 แล้ว save ทับ — ตั้ง VS Code: files.encoding = utf8, files.autoGuessEncoding = false");
  console.error("แก้ไฟล์ให้เป็นไทยปกติก่อน แล้ว commit ใหม่ (ข้ามชั่วคราวได้ด้วย git commit --no-verify หากจำเป็นจริงๆ)");
  console.error("");
  process.exit(1);
}

if (!stagedMode) {
  console.log("✅ ไม่พบ mojibake ในไฟล์ที่ track ทั้งหมด");
}
