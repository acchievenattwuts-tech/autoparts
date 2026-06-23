import * as assert from "node:assert/strict";
import {
  buildProductResearchPrompt,
  normalizeProductAiResearchDraft,
  type ProductAiResearchInput,
} from "../lib/product-ai-research";

const input: ProductAiResearchInput = {
  productName: "กรองแอร์ Mazda 2",
  partsBrandName: "Denso",
  fitmentText: "Mazda / Mazda 2 2015-2022",
  categoryName: "กรองแอร์",
};

const prompt = buildProductResearchPrompt(input);
assert.match(prompt, /Lazada ประเทศไทยเท่านั้น/);
assert.match(prompt, /ห้ามใช้ https:\/\/www\.sriwanparts\.com/);
assert.match(prompt, /ชื่อสินค้า: กรองแอร์ Mazda 2/);
assert.match(prompt, /ยี่ห้อสินค้า: Denso/);
assert.match(prompt, /รุ่นรถที่ใช้ได้: Mazda \/ Mazda 2 2015-2022/);

const normalized = normalizeProductAiResearchDraft({
  productName: { value: " กรองแอร์ Mazda 2 2015-2022 ", confidence: "VERIFIED" },
  category: { value: "กรองแอร์", confidence: "VERIFIED" },
  partsBrand: { value: "Denso", confidence: "VERIFIED" },
  descriptionCopyBox: "รายละเอียดสินค้า",
  aliases: {
    ALIAS: { csv: "กรองแอร์,ไส้กรองแอร์" },
    OEM: { csv: "" },
    PART_NO: { csv: "DCC5001" },
    CROSS_REF: { csv: "" },
    KEYWORD: { csv: "Mazda 2,มาสด้า2" },
    MISSPELL: { csv: "กรองแอ,มาสด้า 2" },
    EN: { csv: "cabin filter,air filter" },
    TH: { csv: "กรองแอร์รถยนต์" },
  },
  verifiedFitments: [
    { make: "Mazda", model: "Mazda 2", yearStart: 2015, yearEnd: 2022, engineSize: "", engineCode: "", submodel: "", note: "" },
  ],
  possibleInterchange: [],
  needReview: [],
  sources: [
    { title: "Shopee TH", url: "https://shopee.co.th/example", sourceType: "SHOPEE_TH", usedFor: ["alias"] },
    { title: "Forbidden", url: "https://www.sriwanparts.com/product/1", sourceType: "THAI_TRUSTED_PARTS_SELLER", usedFor: ["blocked"] },
    { title: "Foreign", url: "https://example.com/parts", sourceType: "THAI_TRUSTED_PARTS_SELLER", usedFor: ["blocked"] },
  ],
});

assert.equal(normalized.productName.value, "กรองแอร์ Mazda 2 2015-2022");
assert.equal(normalized.aliases.ALIAS.csv, "กรองแอร์,ไส้กรองแอร์");
assert.equal(normalized.aliases.KEYWORD.csv, "Mazda 2,มาสด้า2");
assert.equal(normalized.sources.length, 1);
assert.equal(normalized.blockedOrRejectedSources.length, 2);
assert.equal(normalized.warnings.some((warning) => warning.includes("sriwanparts")), true);

const missingRequired = normalizeProductAiResearchDraft({ aliases: { OEM: { csv: "88320" } } });
assert.equal(missingRequired.aliases.ALIAS.csv.length > 0, true);
assert.equal(missingRequired.aliases.KEYWORD.csv.length > 0, true);
assert.equal(missingRequired.aliases.MISSPELL.csv.length > 0, true);
assert.equal(missingRequired.aliases.EN.csv.length > 0, true);
assert.equal(missingRequired.aliases.TH.csv.length > 0, true);
assert.equal(missingRequired.warnings.some((warning) => warning.includes("บังคับ")), true);

// Buddhist-era years from AI must be converted to Gregorian, with a warning.
const beYears = normalizeProductAiResearchDraft({
  verifiedFitments: [
    { make: "Toyota", model: "Vios", yearStart: 2558, yearEnd: 2565, engineSize: "", engineCode: "", submodel: "", note: "" },
  ],
});
assert.equal(beYears.verifiedFitments[0].yearStart, 2015);
assert.equal(beYears.verifiedFitments[0].yearEnd, 2022);
assert.equal(beYears.warnings.some((warning) => warning.includes("พ.ศ.")), true);

// Gregorian years must be left untouched (no false conversion).
const ceYears = normalizeProductAiResearchDraft({
  verifiedFitments: [
    { make: "Honda", model: "Civic", yearStart: 2006, yearEnd: 2011, engineSize: "", engineCode: "", submodel: "", note: "" },
  ],
});
assert.equal(ceYears.verifiedFitments[0].yearStart, 2006);
assert.equal(ceYears.verifiedFitments[0].yearEnd, 2011);
assert.equal(ceYears.warnings.some((warning) => warning.includes("พ.ศ.")), false);

console.log("product-ai-research tests passed");
