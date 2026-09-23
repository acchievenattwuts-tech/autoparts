import assert from "node:assert/strict";
import test from "node:test";
import { shouldResyncDesktopDraft } from "../ProductFilterBar";
import { EMPTY_FILTERS, type AppliedFilters } from "@/components/shared/ProductFilterPanel";

const applied = (overrides: Partial<AppliedFilters> = {}): AppliedFilters => ({
  ...EMPTY_FILTERS,
  categories: ["คอมแอร์"],
  carBrands: ["Toyota"],
  ...overrides,
});

test("a re-render that hands over a NEW object with the SAME applied values keeps the draft", () => {
  // SearchResults builds appliedFilters as an inline literal on every render
  // (e.g. when infinite scroll finishes loading the next page).
  assert.equal(
    shouldResyncDesktopDraft({ applied: applied(), resetToken: 3 }, { applied: applied(), resetToken: 3 }),
    false,
  );
});

test("array order alone is not a change", () => {
  assert.equal(
    shouldResyncDesktopDraft(
      { applied: applied({ carBrands: ["Toyota", "Honda"] }), resetToken: 0 },
      { applied: applied({ carBrands: ["Honda", "Toyota"] }), resetToken: 0 },
    ),
    false,
  );
});

test("a real change in applied values resyncs the draft", () => {
  assert.equal(
    shouldResyncDesktopDraft(
      { applied: applied(), resetToken: 0 },
      { applied: applied({ priceMax: 5000 }), resetToken: 0 },
    ),
    true,
  );
});

test("a bumped reset token resyncs the draft even when the values are unchanged", () => {
  // External navigation back to the same filters, or a did-you-mean result.
  assert.equal(
    shouldResyncDesktopDraft({ applied: applied(), resetToken: 1 }, { applied: applied(), resetToken: 2 }),
    true,
  );
});
