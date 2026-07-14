/**
 * setup-git-hooks.mjs — points git at the repo's committed hooks (.githooks/)
 * so the mojibake pre-commit guard is active on every clone after npm install.
 * Silently a no-op outside a git checkout (CI / Vercel build).
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // not a git repo or git unavailable — nothing to set up
}
