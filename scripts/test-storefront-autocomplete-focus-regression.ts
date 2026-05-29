import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function runStorefrontAutocompleteFocusRegressionChecks() {
  const autocomplete = readRepoFile("components/shared/ProductAutocomplete.tsx");

  expectIncludes(
    autocomplete,
    "const [hasInlineFocus, setHasInlineFocus] = useState(false);",
    "ProductAutocomplete must track inline focus state so dropdown visibility can be gated by focus",
  );

  expectIncludes(
    autocomplete,
    "const shouldAutoOpen = modalOpen || hasInlineFocus;",
    "Autocomplete fetch effect must only auto-open inline results while focused or while the mobile modal is open",
  );

  expectIncludes(
    autocomplete,
    "setHasInlineFocus(false);",
    "Autocomplete must close inline results when focus leaves the inline search control",
  );

  expectIncludes(
    autocomplete,
    "setOpen(false);",
    "Autocomplete must close inline results when focus leaves the inline search control",
  );

  expectIncludes(
    autocomplete,
    "const isExpanded = hasInlineFocus || open;",
    "Desktop storefront autocomplete should only stay expanded while focused or actively open",
  );
}

runStorefrontAutocompleteFocusRegressionChecks();

console.log("Storefront autocomplete focus regression checks passed");
