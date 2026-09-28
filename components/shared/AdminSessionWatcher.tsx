"use client";

import { useEffect } from "react";

import {
  ADMIN_SESSION_CHECK_INTERVAL_MS,
  ADMIN_SESSION_STATUS_PATH,
  buildAdminSessionEndLoginPath,
  resolveAdminSessionEndReason,
  shouldCheckAdminSessionOnEvent,
} from "@/lib/admin-session-watch";

/**
 * Sends an open admin tab to the login page once its session ends elsewhere —
 * see lib/admin-session-watch.ts. Checks every 30s while the tab is visible and
 * right away when the tab regains focus, becomes visible or comes back online.
 * Renders nothing.
 */
const AdminSessionWatcher = (): null => {
  useEffect(() => {
    let lastCheckedAt = Date.now();
    let inFlight = false;
    let leaving = false;

    const check = async (): Promise<void> => {
      if (inFlight || leaving) return;
      inFlight = true;
      lastCheckedAt = Date.now();
      try {
        const response = await fetch(ADMIN_SESSION_STATUS_PATH, { cache: "no-store" });
        const body: unknown = response.status === 401 ? await response.json().catch(() => null) : null;
        const reason = resolveAdminSessionEndReason(response.status, body);
        if (reason) {
          leaving = true;
          // A full load, not router.push: drops the client router cache and any
          // page state still showing data this session may no longer see.
          window.location.replace(buildAdminSessionEndLoginPath(reason));
        }
      } catch {
        // Offline or a flaky network is not a signed-out session; try again later.
      } finally {
        inFlight = false;
      }
    };

    const checkOnEvent = (): void => {
      if (document.visibilityState === "hidden") return;
      if (!shouldCheckAdminSessionOnEvent({ now: Date.now(), lastCheckedAt })) return;
      void check();
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void check();
    }, ADMIN_SESSION_CHECK_INTERVAL_MS);

    window.addEventListener("focus", checkOnEvent);
    window.addEventListener("online", checkOnEvent);
    document.addEventListener("visibilitychange", checkOnEvent);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkOnEvent);
      window.removeEventListener("online", checkOnEvent);
      document.removeEventListener("visibilitychange", checkOnEvent);
    };
  }, []);

  return null;
};

export default AdminSessionWatcher;
