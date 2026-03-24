import { auth } from "@/auth";

/**
 * Call at the top of every Server Action that mutates data.
 * Throws if the request is unauthenticated, so callers can wrap in try-catch
 * and return a safe error message to the client.
 */
export const requireAuth = async (): Promise<void> => {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
};
