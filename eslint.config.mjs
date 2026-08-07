import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-build/**",
    ".next-dev/**",
    ".next-local-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Repo-local generated artifacts:
    "lib/generated/prisma/**",
    ".tmp/**",
  ]),
  {
    // Thailand date policy (.rules §8), enforced instead of remembered.
    // Both of these have shipped as real bugs before and are invisible in
    // review: a B.E. year reads as a plausible date, and a UTC day boundary is
    // only wrong for the seven hours either side of midnight Bangkok time.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // `new Intl.DateTimeFormat("th-TH", …)` resolves to the Buddhist
          // calendar and renders 2569 for 2026. Use "th-TH-u-ca-gregory".
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat'] > Literal[value='th-TH']",
          message:
            'ใช้ "th-TH-u-ca-gregory" แทน "th-TH" — "th-TH" ให้ปีพุทธศักราช (พ.ศ.) ดู .rules §8',
        },
        {
          // Same problem via toLocaleDateString / toLocaleTimeString.
          // toLocaleString("th-TH") for NUMBERS is fine and is not matched.
          selector:
            "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/] > Literal[value='th-TH']",
          message:
            'ใช้ "th-TH-u-ca-gregory" แทน "th-TH" — "th-TH" ให้ปีพุทธศักราช (พ.ศ.) ดู .rules §8',
        },
        {
          // `date.toISOString().slice(0, 10)` yields the UTC day, which is the
          // previous day for anything before 07:00 Bangkok. Use the helpers in
          // lib/th-date.ts for date-only business fields.
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message:
            "อย่าใช้ toISOString().slice() กับวันที่ — ได้วัน UTC ไม่ใช่วันไทย ใช้ helper ใน lib/th-date.ts ดู .rules §8",
        },
      ],
    },
  },
]);

export default eslintConfig;
