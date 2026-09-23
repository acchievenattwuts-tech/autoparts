import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "scripts/seed-category-aliases.ts"), "utf8");

test("category alias seed matchers never overlap (a contains-match must hit one category)", () => {
  const matchers = [...source.matchAll(/categoryIncludes:\s*"([^"]+)"/g)].map((match) =>
    match[1].toLowerCase(),
  );

  assert.ok(matchers.includes("(blower motor)"));
  const overlaps = matchers.flatMap((matcher, index) =>
    matchers
      .filter((other, otherIndex) => otherIndex !== index && other.includes(matcher))
      .map((other) => `${matcher} inside ${other}`),
  );
  assert.deepEqual(overlaps, []);
});

test("category alias seed refuses to write when a matcher hits more than one category", () => {
  assert.doesNotMatch(source, /db\.category\.findFirst\(/);
  assert.match(source, /take:\s*2/);
  assert.match(source, /matches\.length > 1/);
});
