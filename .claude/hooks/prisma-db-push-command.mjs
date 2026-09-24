// Pure matcher for the block-prisma-db-push PreToolUse hook. Kept separate
// from the hook entry (which reads stdin at import time) so it can be unit
// tested — see tests/prisma-db-push-hook.test.ts.
//
// Goal: catch real `prisma db push` invocations (npx / npm exec / pnpm / yarn /
// bunx / node .../prisma/build/index.js / package scripts `db:push*`, also
// inside `bash -c "..."` or `Invoke-Expression`) without tripping on text that
// merely mentions the words, such as `grep "prisma db push"` or a commit message.

const LAUNCHERS = new Set([
  "npx", "npm", "pnpm", "yarn", "bun", "bunx", "exec", "dlx", "x", "node",
  "env", "cross-env", "dotenv", "dotenv-cli", "sudo", "time", "timeout", "nice",
  "nohup", "call", "command", "--",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SHELLS = new Set(["bash", "sh", "zsh", "cmd", "powershell", "pwsh"]);
const SHELL_COMMAND_FLAGS = new Set(["-c", "/c", "/k", "-command", "-commandwithargs"]);
const EVALUATORS = new Set(["eval", "invoke-expression", "iex"]);
const PRISMA_VALUE_FLAGS = new Set(["--config", "--schema", "--url"]);
const SEGMENT_BREAKS = new Set([";", "&", "|", "\n", "\r", "(", ")"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DURATION = /^\d+(\.\d+)?[smhd]?$/;

/**
 * Split a shell command into segments of tokens. Quotes group words and are
 * removed; unquoted ; & | ( ) and newlines end a segment.
 * @param {string} command
 * @returns {string[][]}
 */
export const tokenizeCommand = (command) => {
  const segments = [];
  let tokens = [];
  let current = "";
  let hasToken = false;
  let quote = null;
  const endToken = () => {
    if (hasToken) tokens.push(current);
    current = "";
    hasToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (SEGMENT_BREAKS.has(ch)) {
      endSegment();
    } else if (/\s/.test(ch)) {
      endToken();
    } else {
      current += ch;
      hasToken = true;
    }
  }
  endSegment();
  return segments;
};

/** @param {string} token */
const baseName = (token) => {
  const normalized = token.replace(/\\/g, "/").toLowerCase();
  return normalized.slice(normalized.lastIndexOf("/") + 1).replace(/\.(cmd|exe|ps1)$/, "");
};

/** @param {string} token */
const isPrismaToken = (token) =>
  /^prisma(@\S*)?$/.test(baseName(token)) ||
  token.replace(/\\/g, "/").toLowerCase().endsWith("prisma/build/index.js");

/** @param {string[]} args tokens after the prisma executable */
const isDbPushArgs = (args) => {
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("-")) positionals.push(token);
    else if (PRISMA_VALUE_FLAGS.has(token)) i += 1;
  }
  return positionals[0] === "db" && positionals[1] === "push";
};

/** @param {string[]} tokens */
const runsDbPushPackageScript = (tokens) => {
  const first = tokens.find((token) => !ASSIGNMENT.test(token));
  if (!first || !PACKAGE_MANAGERS.has(baseName(first))) return false;
  return tokens.some((token) => token === "db:push" || token.startsWith("db:push:"));
};

/**
 * @param {string[]} tokens
 * @param {number} depth
 */
const segmentRunsDbPush = (tokens, depth) => {
  if (runsDbPushPackageScript(tokens)) return true;
  let prefixIntact = true;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    const next = tokens[i + 1];
    if (next !== undefined && SHELL_COMMAND_FLAGS.has(lower) && tokens.slice(0, i).some((t) => SHELLS.has(baseName(t)))) {
      if (commandRunsPrismaDbPush(next, depth + 1)) return true;
    }
    if (EVALUATORS.has(lower) && commandRunsPrismaDbPush(tokens.slice(i + 1).join(" "), depth + 1)) return true;
    if (!prefixIntact) continue;
    if (isPrismaToken(token)) {
      if (isDbPushArgs(tokens.slice(i + 1))) return true;
      continue;
    }
    const previous = tokens[i - 1];
    const previousWasFlag = previous !== undefined && previous.startsWith("-") && !previous.includes("=");
    prefixIntact =
      LAUNCHERS.has(baseName(token)) ||
      token.startsWith("-") ||
      ASSIGNMENT.test(token) ||
      DURATION.test(token) ||
      previousWasFlag;
  }
  return false;
};

const MAX_DEPTH = 3;
const HEREDOC_START = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/**
 * Drop heredoc bodies (`cat <<'EOF' > file ... EOF`) — they are data being
 * written somewhere, not commands.
 * @param {string} command
 * @returns {string}
 */
export const stripHeredocBodies = (command) => {
  const lines = command.split(/\r?\n/);
  const kept = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    kept.push(line);
    const match = HEREDOC_START.exec(line);
    if (match) terminator = match[2];
  }
  return kept.join("\n");
};

/**
 * True when the shell command would run `prisma db push`.
 * @param {string} command
 * @param {number} [depth]
 * @returns {boolean}
 */
export const commandRunsPrismaDbPush = (command, depth = 0) => {
  if (depth > MAX_DEPTH || typeof command !== "string" || !/push/i.test(command)) return false;
  return tokenizeCommand(stripHeredocBodies(command)).some((tokens) => segmentRunsDbPush(tokens, depth));
};

export const PRISMA_DB_PUSH_BLOCK_MESSAGE = [
  "[hook block] `prisma db push` is not allowed from Claude Code in this repo (.rules §6).",
  "  The database holds search indexes and product_search_documents.trgm_text that live outside",
  "  prisma/schema.prisma; db push (and npm run db:push) would DROP them on production.",
  "  Instead: write additive SQL in prisma/migrations/<YYYYMMDD>_<name>/migration.sql",
  "  (CREATE INDEX CONCURRENTLY, one statement at a time), apply it with `prisma db execute --file`",
  "  after the user confirms, then run `npx tsx scripts/check-schema-drift.ts`.",
  "  If a push is truly required (e.g. a local database), ask the user to run it themselves.",
].join("\n");
