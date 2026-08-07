"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR mount guard for components that render through a portal.
 *
 * `createPortal` needs a real DOM node, so a portal component must render
 * nothing on the server and during the first (hydrating) client render, then
 * flip to mounted. The classic way to express that is
 * `useState(false)` + `useEffect(() => setMounted(true), [])`, but calling
 * setState synchronously inside an effect schedules a second render pass on
 * every mount — React's `set-state-in-effect` rule flags it for exactly that
 * reason.
 *
 * `useSyncExternalStore` expresses the same thing declaratively: React reads
 * the server snapshot while rendering on the server / hydrating, and the client
 * snapshot afterwards. Same visible result, one render instead of two.
 *
 * The store never changes, so `subscribe` hands back a no-op unsubscribe and
 * is defined at module scope — an inline arrow would be a new reference on
 * every render and make React resubscribe each time.
 */

/** Never notifies: `mounted` only ever goes false → true, driven by hydration. */
export const subscribeToMountedStore = (): (() => void) => () => {};

/** After hydration the component is on a real client with a DOM. */
export const getMountedClientSnapshot = (): boolean => true;

/** While server-rendering (and during hydration) there is no DOM to portal into. */
export const getMountedServerSnapshot = (): boolean => false;

export const useMounted = (): boolean =>
  useSyncExternalStore(
    subscribeToMountedStore,
    getMountedClientSnapshot,
    getMountedServerSnapshot,
  );
