import { after } from "next/server";

type RequestLifetimeRegistrar = (task: Promise<unknown>) => void;

let hasWarnedAboutMissingRequestLifetime = false;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Start cached search regeneration on the next microtask and register the whole
 * promise with Next's request lifecycle before any DB transaction can open.
 *
 * `unstable_cache` refreshes stale entries in the background. On Vercel, a
 * promise that is not attached to `waitUntil` can be frozen after the response,
 * leaving an interactive Prisma transaction to expire before the next request
 * wakes the instance. `after(promise)` delegates to `waitUntil`, keeping that
 * refresh alive while preserving Next's distributed cache, stale response,
 * pending-refresh deduplication, and stale-if-error behaviour.
 *
 * The injectable registrar keeps this helper testable and allows non-request
 * callers (for example scripts) to keep using the search function. In that case
 * the caller already awaits the returned promise, so lifecycle registration is
 * unnecessary.
 */
export function runProductSearchRefreshWithRequestLifetime<T>(
  taskFactory: () => Promise<T>,
  register: RequestLifetimeRegistrar = after,
): Promise<T> {
  const task = Promise.resolve().then(taskFactory);

  try {
    register(task);
  } catch (error) {
    if (!hasWarnedAboutMissingRequestLifetime) {
      hasWarnedAboutMissingRequestLifetime = true;
      console.warn(
        "Product search refresh could not register with the request lifecycle; " +
          "continuing because the foreground caller still awaits it.",
        describeError(error),
      );
    }
  }

  return task;
}
