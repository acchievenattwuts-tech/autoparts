import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, ".codex", "skills");

const args = process.argv.slice(2);
const force = args.includes("--force");
const all = args.includes("--all");
const help = args.includes("--help") || args.includes("-h");

const positional = args.filter((arg) => !arg.startsWith("--"));
const requestedSkill = positional[0] ?? null;

const printUsage = () => {
  console.log(`Usage:
  node scripts/install-codex-skill.mjs seo-aio
  node scripts/install-codex-skill.mjs --all
  node scripts/install-codex-skill.mjs seo-aio --force

Options:
  --all    Install every repo-local skill under .codex/skills
  --force  Overwrite the destination if the skill already exists
  --help   Show this help text`);
};

if (help) {
  printUsage();
  process.exit(0);
}

if (!existsSync(sourceRoot)) {
  console.error(`Skill source directory not found: ${sourceRoot}`);
  process.exit(1);
}

const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
const destinationRoot = path.join(codexHome, "skills");

mkdirSync(destinationRoot, { recursive: true });

const availableSkills = readdirSync(sourceRoot).filter((entry) => {
  const entryPath = path.join(sourceRoot, entry);
  return statSync(entryPath).isDirectory();
});

const skillsToInstall = all
  ? availableSkills
  : requestedSkill
    ? [requestedSkill]
    : [];

if (skillsToInstall.length === 0) {
  console.error("Specify a skill name or use --all.");
  printUsage();
  process.exit(1);
}

for (const skillName of skillsToInstall) {
  const sourcePath = path.join(sourceRoot, skillName);
  const destinationPath = path.join(destinationRoot, skillName);

  if (!existsSync(sourcePath)) {
    console.error(`Skill not found in repo: ${skillName}`);
    process.exit(1);
  }

  cpSync(sourcePath, destinationPath, {
    recursive: true,
    force,
    errorOnExist: !force,
  });

  console.log(`Installed ${skillName} -> ${destinationPath}`);
}

console.log("Restart Codex to pick up new skills.");
