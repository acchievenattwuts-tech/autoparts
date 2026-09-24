import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { commandRunsPrismaDbPush } from "../.claude/hooks/prisma-db-push-command.mjs";

const HOOK = join(process.cwd(), ".claude", "hooks", "block-prisma-db-push.mjs");

test("matches real prisma db push invocations", () => {
  for (const command of [
    "prisma db push",
    "npx prisma db push",
    "npx prisma db push --accept-data-loss",
    "npx --yes prisma@7.5.0 db push",
    "npm exec prisma db push",
    "npm exec -- prisma db push",
    "npm exec --package prisma -- prisma db push",
    "pnpm prisma db push",
    "pnpm exec prisma db push",
    "yarn prisma db push",
    "bunx prisma db push",
    "npx prisma --config prisma.config.ts db push",
    "npx prisma db push --schema prisma/schema.prisma",
    "node node_modules/prisma/build/index.js db push",
    ".\\node_modules\\.bin\\prisma.cmd db push",
    "& \"node_modules\\.bin\\prisma.cmd\" db push",
    "DATABASE_URL=postgres://x npx prisma db push",
    "npx dotenv -e .env.local -- prisma db push",
    "timeout 60 npx prisma db push 2>&1 | tail -5",
    "cd app && npx prisma db push",
    "npx prisma generate; npx prisma db push",
    "bash -c \"npx prisma db push\"",
    "powershell -Command \"npx prisma db push\"",
    "Invoke-Expression 'npx prisma db push'",
    "npm run db:push",
    "npm run db:push:accept-data-loss",
    "pnpm db:push",
    "echo $(npx prisma db push)",
  ]) {
    assert.equal(commandRunsPrismaDbPush(command), true, command);
  }
});

test("does not match commands that only mention db push or run other Prisma commands", () => {
  for (const command of [
    "npx prisma generate",
    "npx prisma validate",
    "npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script",
    "npx prisma db execute --file prisma/migrations/20260924_add_query_indexes/migration.sql",
    "npx prisma db pull",
    "git push origin main",
    'grep -rn "prisma db push" docs',
    "rg 'npx prisma db push' .rules",
    'git commit -m "docs: never run npx prisma db push"',
    "echo npx prisma db push",
    "npx tsx scripts/check-schema-drift.ts",
    "cat <<'EOF' > notes.md\nnpx prisma db push\nEOF",
    "npm run build",
  ]) {
    assert.equal(commandRunsPrismaDbPush(command), false, command);
  }
});

const runHook = (payload: unknown): { status: number | null; stderr: string } => {
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
};

test("the hook exits 2 with the additive-SQL procedure for a db push command", () => {
  const result = runHook({ tool_name: "Bash", tool_input: { command: "npx prisma db push" } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /prisma\/migrations/);
  assert.match(result.stderr, /check-schema-drift/);
});

test("the hook lets other commands and malformed payloads through", () => {
  assert.equal(runHook({ tool_name: "PowerShell", tool_input: { command: "npx prisma generate" } }).status, 0);
  assert.equal(runHook({ tool_name: "Bash", tool_input: {} }).status, 0);
  const malformed = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
  assert.equal(malformed.status, 0);
});
