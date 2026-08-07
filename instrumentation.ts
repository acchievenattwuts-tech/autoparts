/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * Intentionally empty. Anything scheduled here with an in-process timer
 * (node-cron, setInterval) does not survive on Vercel: instances are frozen
 * between requests and recycled, so a job scheduled hours ahead effectively
 * never fires, and when it does it fires on every warm instance at once.
 *
 * Recurring work belongs in `vercel.json` "crons" pointing at an
 * `/api/**\/cron/*` route guarded by CRON_SECRET — see
 * app/api/notifications/cron/cleanup/route.ts for the pattern.
 */

export async function register() {
  // No startup work. See the note above before adding any.
}
