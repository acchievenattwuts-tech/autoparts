import { Prisma } from "@/lib/generated/prisma";

/**
 * Document numbers (lib/doc-number.ts) are generated as "latest + 1" outside the
 * write transaction. Two users saving at the same moment can get the same number;
 * the @unique column rejects the second insert with P2002 and the whole transaction
 * rolls back. These helpers let a create action regenerate the number and retry
 * instead of failing — the numbering format and sequence logic are unchanged.
 */
export const DOC_NUMBER_MAX_ATTEMPTS = 3;

type UniqueViolationMeta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: {
        fields?: unknown;
        index?: unknown;
      };
    };
  };
};

const stripIdentifierQuotes = (value: string): string => value.trim().replace(/^"+|"+$/g, "");

/**
 * Returns the column / constraint names reported by a unique-constraint violation
 * (Prisma P2002), or null when the error is not a P2002. Prisma 7 driver adapters
 * report the columns under `meta.driverAdapterError.cause.constraint` (quoted, e.g.
 * `"saleNo"`); older engines used `meta.target`. Both shapes are read.
 */
export function getUniqueViolationFields(error: unknown): string[] | null {
  if (typeof error !== "object" || error === null) return null;
  if ((error as { code?: unknown }).code !== "P2002") return null;

  const meta = (error as { meta?: UniqueViolationMeta }).meta;
  const fields: string[] = [];
  const target = meta?.target;
  if (Array.isArray(target)) {
    fields.push(...target.filter((value): value is string => typeof value === "string"));
  } else if (typeof target === "string") {
    fields.push(target);
  }

  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) {
    fields.push(...constraint.fields.filter((value): value is string => typeof value === "string"));
  }
  if (typeof constraint?.index === "string") {
    fields.push(constraint.index);
  }

  return fields.map(stripIdentifierQuotes);
}

/** True only when the error is a P2002 that positively names `field` (column or `Model_field_key` index). */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  const fields = getUniqueViolationFields(error);
  if (!fields) return false;
  return fields.some((value) => value === field || value.split("_").includes(field));
}

/**
 * Generates a document number and runs `run` with it. When `run` fails because
 * another save took the same number (P2002 on `uniqueField`), a fresh number is
 * generated and `run` is retried, up to `maxAttempts` in total. Any other error —
 * or the last failed attempt — is rethrown unchanged. `run` must be safe to repeat
 * (a single rolled-back transaction, with per-attempt state reset inside it).
 */
export async function withDocNumberRetry<T>(options: {
  uniqueField: string;
  generate: () => Promise<string>;
  run: (docNo: string) => Promise<T>;
  maxAttempts?: number;
}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DOC_NUMBER_MAX_ATTEMPTS);
  for (let attempt = 1; ; attempt += 1) {
    const docNo = await options.generate();
    try {
      return await options.run(docNo);
    } catch (error) {
      if (attempt >= maxAttempts || !isUniqueViolationOn(error, options.uniqueField)) throw error;
    }
  }
}

/**
 * True for errors raised by Prisma or the database driver (constraint failures,
 * lock / statement timeouts, connection problems). Their messages carry internal
 * table / column / host details and must not be shown to users.
 */
export function isDatabaseLayerError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientValidationError ||
    (error instanceof Error && error.name === "DriverAdapterError")
  );
}
