import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";

type ConnectedPgAdapter = Awaited<ReturnType<PrismaPg["connect"]>>;

/** Register Prisma's own lazily created pool with the Fluid lifecycle. */
export class FluidPrismaPg extends PrismaPg {
  override async connect(): Promise<ConnectedPgAdapter> {
    let adapter: ConnectedPgAdapter | undefined;
    try {
      adapter = await super.connect();
      if (process.env.VERCEL) {
        attachDatabasePool(adapter.underlyingDriver());
      }
      return adapter;
    } catch (error) {
      // A failed registration must not leave an unused pool behind.
      if (adapter) await adapter.dispose();
      throw error;
    }
  }
}
