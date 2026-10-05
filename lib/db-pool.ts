import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";

type ConnectedPgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;
type PgIsolationLevel = Parameters<ConnectedPgAdapter["startTransaction"]>[0];
type PgTransaction = Awaited<ReturnType<ConnectedPgAdapter["startTransaction"]>>;

let hasWarnedAboutFluidAttachFailure = false;

/**
 * An interactive transaction owns ONE pg connection, but Prisma 7 loads sibling
 * relations (2+ relations in one `include` / nested `select`) with Promise.all.
 * pg@8 queues the overlapping client.query() calls itself and logs
 * "DeprecationWarning: Calling client.query() when the client is already
 * executing a query"; pg@9 throws instead. Run the transaction's statements one
 * at a time in call order — what pg@8 already does internally, so results and
 * timing stay the same. Queries outside a transaction stay concurrent: the pool
 * gives each its own connection.
 *
 * Mirrors prisma/orm#29979. Drop it once the installed @prisma/adapter-pg
 * serializes on its own — the canary in
 * `lib/__tests__/pg-transaction-serialization.golden.test.ts` fails then.
 *
 * Locked at queryRaw/executeRaw (performIO is private in the typings). Do not
 * pass a `userDefinedTypeParser` that queries the transaction it is handed: it
 * would run inside the caller's turn and wait on itself.
 */
const serializeTransactionQueries = (tx: PgTransaction): PgTransaction => {
  // Resolve-only tail: it records when the previous statement settled and never
  // carries its error, so a failed statement rejects only its own caller.
  let tail: Promise<void> = Promise.resolve();
  const runInOrder = async <T>(statement: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let settle: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      settle = resolve;
    });
    await previous;
    try {
      return await statement();
    } finally {
      settle();
    }
  };

  const queryRaw = tx.queryRaw.bind(tx);
  const executeRaw = tx.executeRaw.bind(tx);
  // Savepoint helpers and Prisma's COMMIT / ROLLBACK go through executeRaw, so
  // they wait for every statement issued before them.
  tx.queryRaw = (query) => runInOrder(() => queryRaw(query));
  tx.executeRaw = (query) => runInOrder(() => executeRaw(query));
  return tx;
};

/**
 * Fluid registration is an optimization only. If the helper rejects the pool
 * (e.g. "Unsupported database pool type" after a pg / @vercel/functions
 * upgrade), keep the working adapter so the database stays reachable.
 */
const attachToFluidLifecycle = (adapter: ConnectedPgAdapter): void => {
  try {
    attachDatabasePool(adapter.underlyingDriver());
  } catch (error) {
    if (hasWarnedAboutFluidAttachFailure) return;
    hasWarnedAboutFluidAttachFailure = true;
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(
      `[db-pool] attachDatabasePool failed (${reason}); continuing without Fluid idle-pool registration.`,
    );
  }
};

/**
 * Register Prisma's own lazily created pool with the Fluid lifecycle, and run
 * each transaction's statements one at a time on its single connection.
 */
export class FluidPrismaPg extends PrismaPg {
  override async connect(): Promise<ConnectedPgAdapter> {
    // A connect failure propagates to Prisma unchanged; only the Fluid
    // registration below is allowed to fail softly.
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (isolationLevel?: PgIsolationLevel): Promise<PgTransaction> =>
      serializeTransactionQueries(await startTransaction(isolationLevel));
    if (process.env.VERCEL) attachToFluidLifecycle(adapter);
    return adapter;
  }
}
