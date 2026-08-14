/**
 * Coverage suite for every active car model in the shop's Thailand master data.
 *
 * Default: deterministic production resolver for all models + alias coverage.
 * --live: additionally calls the real Gemini classifier with correct English,
 *         misspelled English, and curated Thai model aliases.
 *
 * Read-only. Requires DATABASE_URL; --live also requires a Gemini API key.
 */
import { db } from "@/lib/db";
import { LineIntent } from "@/lib/generated/prisma";
import { extractChatSearchIntent } from "@/lib/chat-core/ai-service";
import {
  resolveCanonicalCarModelHint,
  resolveChatFitmentFilters,
} from "@/lib/chat-core/fitment-resolve";
import {
  buildCarModelGroundingLookup,
  buildCarModelVariantLookup,
} from "@/lib/car-model-alias-cache";
import { guardChatSearchIntent } from "@/lib/chat-core/search-guards";
import { normalizeSearchText } from "@/lib/search-normalization";

type ModelRow = {
  name: string;
  carBrand: { name: string; aliases: Array<{ alias: string }> };
};

type LiveCase = {
  kind: "english_correct" | "english_typo" | "thai_alias";
  brand: string;
  model: string;
  text: string;
};

const live = process.argv.includes("--live");
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.max(1, Math.min(10, Number(concurrencyArg?.split("=")[1] ?? 4) || 4));
const delayArg = process.argv.find((arg) => arg.startsWith("--delay-ms="));
const delayMs = Math.max(0, Number(delayArg?.split("=")[1] ?? 0) || 0);
const liveModelsArg = process.argv.find((arg) => arg.startsWith("--live-models="));
const selectedLiveModels = new Set(
  (liveModelsArg?.slice("--live-models=".length) ?? "")
    .split(",")
    .map(normalizeSearchText)
    .filter(Boolean),
);

const same = (a: string | null | undefined, b: string): boolean =>
  normalizeSearchText(a ?? "") === normalizeSearchText(b);

function transposeLatinWord(value: string): string {
  const matches = Array.from(value.matchAll(/[A-Za-z]{4,}/g));
  const match = matches.sort((a, b) => b[0].length - a[0].length)[0];
  if (!match || match.index === undefined) return value.replace(/[\s-]+/g, "");
  const word = match[0];
  const index = Math.max(1, word.length - 2);
  const typo = `${word.slice(0, index)}${word[index + 1]}${word[index]}${word.slice(index + 2)}`;
  return `${value.slice(0, match.index)}${typo}${value.slice(match.index + word.length)}`;
}

function vehiclePhrase(brand: string, model: string): string {
  const normalizedBrand = normalizeSearchText(brand).replace(/\s+/g, "");
  const normalizedModel = normalizeSearchText(model).replace(/\s+/g, "");
  return normalizedModel.startsWith(normalizedBrand) ? model : `${brand} ${model}`;
}

const wait = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

async function main(): Promise<void> {
  const [models, synonymRows] = await Promise.all([
    db.carModel.findMany({
      where: { isActive: true, carBrand: { isActive: true } },
      select: {
        name: true,
        carBrand: {
          select: {
            name: true,
            aliases: { where: { isActive: true }, select: { alias: true } },
          },
        },
      },
      orderBy: [{ carBrand: { name: "asc" } }, { name: "asc" }],
    }),
    db.searchSynonym.findMany({ where: { isActive: true }, select: { term: true, synonyms: true } }),
  ]);

  const synonymsByTerm = new Map(
    synonymRows.map((row) => [normalizeSearchText(row.term), row.synonyms]),
  );
  const modelLookup = buildCarModelVariantLookup(synonymRows);
  const modelGroundingLookup = buildCarModelGroundingLookup(synonymRows);
  const deterministicFailures: string[] = [];
  const aliasFailures: string[] = [];
  let testedSafeAliases = 0;

  const aliasOwners = new Map<string, Set<string>>();
  for (const row of synonymRows) {
    const canonical = normalizeSearchText(row.term);
    for (const variant of [row.term, ...row.synonyms]) {
      const key = normalizeSearchText(variant);
      if (!key) continue;
      const owners = aliasOwners.get(key) ?? new Set<string>();
      owners.add(canonical);
      aliasOwners.set(key, owners);
    }
  }

  for (const model of models) {
    const filters = await resolveChatFitmentFilters({
      carBrand: model.carBrand.name,
      carModel: model.name,
      partType: "หม้อน้ำ",
      queryText: `radiator ${model.carBrand.name} ${model.name}`,
      rawText: `radiator ${model.carBrand.name} ${model.name}`,
    });
    if (!same(filters.carBrandName, model.carBrand.name) || !same(filters.carModelName, model.name)) {
      deterministicFailures.push(
        `${model.carBrand.name} ${model.name} -> ${filters.carBrandName ?? "-"}/${filters.carModelName ?? "-"}`,
      );
    }

    const variants = synonymsByTerm.get(normalizeSearchText(model.name)) ?? [];
    for (const variant of variants) {
      const owners = aliasOwners.get(normalizeSearchText(variant));
      if (owners?.size !== 1) continue;
      testedSafeAliases += 1;
      const resolved = resolveCanonicalCarModelHint(variant, modelLookup);
      if (!resolved || !same(resolved.canonicalModel, model.name)) {
        aliasFailures.push(
          `${model.carBrand.name} ${model.name} alias "${variant}" -> ${resolved?.canonicalModel ?? "-"}`,
        );
      }
    }
  }

  const missingSynonym = models.filter(
    (model) => !synonymsByTerm.has(normalizeSearchText(model.name)),
  );
  const missingThaiAlias = models.filter((model) => {
    const synonyms = synonymsByTerm.get(normalizeSearchText(model.name)) ?? [];
    return !synonyms.some((synonym) => /[ก-๙]/.test(synonym));
  });

  console.log(
    JSON.stringify(
      {
        activeModels: models.length,
        deterministicResolved: models.length - deterministicFailures.length,
        deterministicFailures,
        safeAliasesTested: testedSafeAliases,
        safeAliasResolved: testedSafeAliases - aliasFailures.length,
        aliasFailures,
        synonymCoverage: models.length - missingSynonym.length,
        thaiAliasCoverage: models.length - missingThaiAlias.length,
        missingSynonym: missingSynonym.map((model) => `${model.carBrand.name} ${model.name}`),
        missingThaiAlias: missingThaiAlias.map((model) => `${model.carBrand.name} ${model.name}`),
      },
      null,
      2,
    ),
  );

  if (deterministicFailures.length > 0 || aliasFailures.length > 0) process.exitCode = 1;
  if (!live) return;

  const liveCases: LiveCase[] = [];
  for (const model of models as ModelRow[]) {
    if (
      selectedLiveModels.size > 0 &&
      !selectedLiveModels.has(normalizeSearchText(model.name))
    ) continue;
    liveCases.push({
      kind: "english_correct",
      brand: model.carBrand.name,
      model: model.name,
      text: `Need radiator for ${vehiclePhrase(model.carBrand.name, model.name)}`,
    });
    liveCases.push({
      kind: "english_typo",
      brand: model.carBrand.name,
      model: model.name,
      text: `Need evaporater for ${vehiclePhrase(transposeLatinWord(model.carBrand.name), transposeLatinWord(model.name))}`,
    });

    const modelAliases = synonymsByTerm.get(normalizeSearchText(model.name)) ?? [];
    const thaiModel = modelAliases.find((alias) => /[ก-๙]/.test(alias));
    const thaiBrand = model.carBrand.aliases.find((alias) => /[ก-๙]/.test(alias.alias))?.alias;
    if (thaiModel) {
      liveCases.push({
        kind: "thai_alias",
        brand: model.carBrand.name,
        model: model.name,
        text: `คอยเย็น ${vehiclePhrase(thaiBrand ?? model.carBrand.name, thaiModel)}`,
      });
    }
  }

  let finished = 0;
  const outcomes = await mapLimit(liveCases, concurrency, async (testCase) => {
    await wait(delayMs);
    const intent = await extractChatSearchIntent({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      latestText: testCase.text,
      history: [],
    });
    let actualBrand: string | null = null;
    let actualModel: string | null = null;
    const guarded = guardChatSearchIntent({
      intent,
      latestText: testCase.text,
      history: [],
      modelLookup,
      modelGroundingLookup,
    });
    if (guarded.intent?.carModel) {
      const filters = await resolveChatFitmentFilters({
        carBrand: guarded.intent.carBrand,
        carModel: guarded.intent.carModel,
        partType: guarded.intent.partType,
        queryText: guarded.forceLiteralQuery ? testCase.text : guarded.intent.query,
        rawText: testCase.text,
        modelLookup,
      });
      actualBrand = filters.carBrandName ?? null;
      actualModel = filters.carModelName ?? null;
    }

    const status =
      same(actualBrand, testCase.brand) && same(actualModel, testCase.model)
        ? "PASS"
        : !actualModel
          ? "SAFE_MISS"
          : "WRONG";
    finished += 1;
    if (finished % 25 === 0 || finished === liveCases.length) {
      console.log(`live progress ${finished}/${liveCases.length}`);
    }
    return {
      ...testCase,
      status,
      actualBrand,
      actualModel,
      classifier: intent?.carModel ?? null,
      guardedModel: guarded.intent?.carModel ?? null,
    };
  });

  const summary = Object.fromEntries(
    (["english_correct", "english_typo", "thai_alias"] as const).map((kind) => {
      const rows = outcomes.filter((outcome) => outcome.kind === kind);
      return [kind, {
        total: rows.length,
        pass: rows.filter((row) => row.status === "PASS").length,
        safeMiss: rows.filter((row) => row.status === "SAFE_MISS").length,
        wrong: rows.filter((row) => row.status === "WRONG").length,
      }];
    }),
  );
  const problems = outcomes.filter((outcome) => outcome.status !== "PASS");
  const wrong = problems.filter((outcome) => outcome.status === "WRONG");
  const safeMissSamples = problems.filter((outcome) => outcome.status === "SAFE_MISS").slice(0, 40);
  console.log(JSON.stringify({
    liveSummary: summary,
    problemCount: problems.length,
    wrong,
    safeMissSamples,
    note: problems.length > wrong.length + safeMissSamples.length
      ? "safe-miss output truncated; summary counts are complete"
      : undefined,
  }, null, 2));

  const canonicalProblems = outcomes.filter(
    (outcome) => outcome.kind === "english_correct" && outcome.status !== "PASS",
  );
  const wrongAnswers = outcomes.filter((outcome) => outcome.status === "WRONG");
  if (canonicalProblems.length > 0 || wrongAnswers.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
