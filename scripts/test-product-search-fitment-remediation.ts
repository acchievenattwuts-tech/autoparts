import assert from "node:assert/strict";

import {
  parseFitmentYearHint,
  validateFitmentYearRange,
} from "../lib/product-search-fitment-remediation";

assert.deepEqual(parseFitmentYearHint("vios 2012"), { yearStart: 2012, yearEnd: 2012 });
assert.deepEqual(parseFitmentYearHint("dmax 2012-2015"), { yearStart: 2012, yearEnd: 2015 });
assert.deepEqual(parseFitmentYearHint("civic 2012/2015"), { yearStart: 2012, yearEnd: 2015 });
assert.deepEqual(parseFitmentYearHint("compressor"), { yearStart: null, yearEnd: null });

assert.deepEqual(validateFitmentYearRange(2012, 2015), { success: true });
assert.deepEqual(validateFitmentYearRange(null, null), { success: true });
assert.equal(validateFitmentYearRange(2016, 2015).success, false);
assert.equal(validateFitmentYearRange(1800, null).success, false);
assert.equal(validateFitmentYearRange(null, 2300).success, false);

console.log("product search fitment remediation tests passed");
