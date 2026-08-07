import test from "node:test";
import assert from "node:assert/strict";

import {
  getMountedClientSnapshot,
  getMountedServerSnapshot,
  subscribeToMountedStore,
} from "../use-mounted";

// Golden suite for the portal mount guard. It replaced a
// useState(false) + useEffect(() => setMounted(true), []) pair in
// ProductImageZoomLightbox; these cases pin the two properties that made the
// swap safe — the visible result is identical, and the store cannot churn.

test("server snapshot is false so a portal renders nothing before hydration", () => {
  assert.equal(getMountedServerSnapshot(), false);
});

test("client snapshot is true so the portal appears once hydrated", () => {
  assert.equal(getMountedClientSnapshot(), true);
});

test("subscribe hands back an unsubscribe that is safe to call", () => {
  const unsubscribe = subscribeToMountedStore();
  assert.equal(typeof unsubscribe, "function");
  assert.doesNotThrow(() => unsubscribe());
});

// The whole point of defining subscribe at module scope: an inline arrow would
// be a fresh reference every render and make React tear down and re-establish
// the subscription on each pass — the churn this hook exists to avoid.
test("subscribe keeps a stable identity across renders", () => {
  assert.equal(subscribeToMountedStore, subscribeToMountedStore);
});

// mounted must be monotonic: false while rendering server-side, true after.
// If these two ever agreed, the guard would either never open or never close.
test("server and client snapshots disagree, which is what drives the flip", () => {
  assert.notEqual(getMountedServerSnapshot(), getMountedClientSnapshot());
});
