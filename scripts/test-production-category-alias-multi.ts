import assert from "node:assert/strict";

import { db } from "@/lib/db";
import {
  matchAllCategoryAliasRows,
  type CategoryAliasResolverRow,
} from "@/lib/category-alias-resolver";
import { detectChatMultiSubjectsFromRows } from "@/lib/chat-core/multi-subject-detector";

const normalize = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

async function main(): Promise<void> {
  const rows: CategoryAliasResolverRow[] = await db.categoryAlias.findMany({
    where: {
      isActive: true,
      OR: [{ kind: "SKIP_CATEGORY" }, { kind: "MATCH", category: { isActive: true } }],
    },
    select: {
      alias: true,
      kind: true,
      matchMode: true,
      priority: true,
      isActive: true,
      category: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: [{ priority: "desc" }, { alias: "asc" }],
  });

  const matchRows = rows.filter(
    (row): row is CategoryAliasResolverRow & { category: NonNullable<CategoryAliasResolverRow["category"]> } =>
      row.kind === "MATCH" && Boolean(row.category),
  );
  const skipRows = rows.filter((row) => row.kind === "SKIP_CATEGORY");
  const failures: string[] = [];

  for (const aliasRow of matchRows) {
    const result = detectChatMultiSubjectsFromRows({ text: aliasRow.alias, rows });
    if (result.subjects || result.categories.length > 1) {
      failures.push(
        `single alias became multi: ${aliasRow.alias} -> ${result.categories.join(", ")}`,
      );
    }
  }

  const overlapPairs: Array<[typeof matchRows[number], typeof matchRows[number]]> = [];
  for (let leftIndex = 0; leftIndex < matchRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matchRows.length; rightIndex += 1) {
      const left = matchRows[leftIndex];
      const right = matchRows[rightIndex];
      if (left.category.id === right.category.id) continue;
      const leftAlias = normalize(left.alias);
      const rightAlias = normalize(right.alias);
      if (leftAlias.includes(rightAlias) || rightAlias.includes(leftAlias)) {
        overlapPairs.push([left, right]);
        const compound = leftAlias.length >= rightAlias.length ? left : right;
        const evidence = matchAllCategoryAliasRows(compound.alias, rows);
        if (evidence.matches.length > 1) {
          failures.push(
            `overlap compound became multi: ${compound.alias} -> ${evidence.matches
              .map((match) => match.categoryName)
              .join(", ")}`,
          );
        }
      }
    }
  }

  let distinctPairCases = 0;
  let distinctPairSkipBlocked = 0;
  let sameCategoryPairCases = 0;
  for (let leftIndex = 0; leftIndex < matchRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matchRows.length; rightIndex += 1) {
      const left = matchRows[leftIndex];
      const right = matchRows[rightIndex];
      const text = `${left.alias}/${right.alias}`;
      const evidence = matchAllCategoryAliasRows(text, rows);
      if (evidence.skippedBy) {
        distinctPairSkipBlocked += left.category.id === right.category.id ? 0 : 1;
        continue;
      }

      const result = detectChatMultiSubjectsFromRows({ text, rows });
      if (left.category.id === right.category.id) {
        sameCategoryPairCases += 1;
        if (result.subjects || result.categories.length > 1) {
          failures.push(`same-category aliases became multi: ${text}`);
        }
        continue;
      }

      // Nested aliases are intentionally represented by the longer canonical
      // category; they are covered by overlapPairs above, not a two-subject case.
      const leftAlias = normalize(left.alias);
      const rightAlias = normalize(right.alias);
      if (leftAlias.includes(rightAlias) || rightAlias.includes(leftAlias)) continue;

      distinctPairCases += 1;
      const mappedIds = new Set(evidence.matches.map((match) => match.categoryId));
      if (!mappedIds.has(left.category.id) || !mappedIds.has(right.category.id)) {
        failures.push(
          `two distinct aliases did not retain both categories: ${text} -> ${evidence.matches
            .map((match) => match.categoryName)
            .join(", ")}`,
        );
      } else if (!result.subjects || result.subjects.length < 2 || result.handoffReason) {
        failures.push(`two distinct aliases did not become safe multi: ${text}`);
      }
    }
  }

  for (const skipRow of skipRows) {
    const sample = `${skipRow.alias}/${matchRows[0]?.alias ?? "สินค้า"}/${matchRows[1]?.alias ?? "อะไหล่"}`;
    const evidence = matchAllCategoryAliasRows(sample, rows);
    if (skipRow.matchMode !== "EXACT" && evidence.skippedBy === null) {
      failures.push(`skip alias did not block synthesis: ${skipRow.alias}`);
    }
  }

  assert.deepEqual(failures, [], failures.slice(0, 30).join("\n"));
  console.log(
    JSON.stringify(
      {
        activeAliases: rows.length,
        matchAliases: matchRows.length,
        skipAliases: skipRows.length,
        overlapPairs: overlapPairs.length,
        singleAliasCases: matchRows.length,
        sameCategoryPairCases,
        distinctPairCases,
        distinctPairSkipBlocked,
        failures: failures.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
