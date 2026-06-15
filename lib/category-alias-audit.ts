export type CategoryAliasCoverageCategory = {
  id: string;
  name: string;
  isActive: boolean;
  aliases: Array<{
    kind: "MATCH" | "SKIP_CATEGORY";
    isActive: boolean;
  }>;
};

export function getCategoryAliasCoverageGaps(categories: CategoryAliasCoverageCategory[]) {
  return categories
    .filter((category) => category.isActive)
    .filter(
      (category) =>
        !category.aliases.some((alias) => alias.kind === "MATCH" && alias.isActive),
    )
    .map((category) => ({ id: category.id, name: category.name }));
}
