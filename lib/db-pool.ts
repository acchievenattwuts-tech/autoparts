import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";

type ConnectedPgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;

let hasWarnedAboutFluidAttachFailure = false;

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

/** Register Prisma's own lazily created pool with the Fluid lifecycle. */
export class FluidPrismaPg extends PrismaPg {
  override async connect(): Promise<ConnectedPgAdapter> {
    // A connect failure propagates to Prisma unchanged; only the Fluid
    // registration below is allowed to fail softly.
    const adapter = await super.connect();
    if (process.env.VERCEL) attachToFluidLifecycle(adapter);
    return adapter;
  }
}
