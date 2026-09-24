#!/usr/bin/env node
// Pre-tool-use guard: block `prisma db push` from Bash / PowerShell tool calls.
// Reads tool-call JSON on stdin, exits 2 to block the call. The matcher lives in
// prisma-db-push-command.mjs. prisma.config.ts carries the real guard for any
// shell; this hook stops an agent before it even tries.
import { readFileSync } from "node:fs";
import { commandRunsPrismaDbPush, PRISMA_DB_PUSH_BLOCK_MESSAGE } from "./prisma-db-push-command.mjs";

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const command = payload?.tool_input?.command;
if (typeof command === "string" && commandRunsPrismaDbPush(command)) {
  process.stderr.write(`${PRISMA_DB_PUSH_BLOCK_MESSAGE}\n  tool: ${payload?.tool_name ?? ""}\n`);
  process.exit(2);
}

process.exit(0);
