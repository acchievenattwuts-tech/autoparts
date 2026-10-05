import assert from "node:assert/strict";
import test from "node:test";

import { isMetaPlatformsIp } from "@/lib/meta-platforms-network";

// Egress review 2026-10-05 (E4): Meta's ad-review crawler is filtered out of the
// storefront visitor stats by network, because its user agent is ordinary Chrome.

test("addresses inside Meta Platforms (AS32934) ranges are recognised", () => {
  for (const ip of [
    "157.240.22.35", // facebook.com edge
    "31.13.66.1",
    "66.220.149.18",
    "69.171.250.10",
    "173.252.107.7",
    "57.144.12.5",
    "2a03:2880:f12f:83:face:b00c:0:25de",
    "2620:0:1c00::1",
    "::ffff:157.240.1.1", // IPv4-mapped IPv6
  ]) {
    assert.equal(isMetaPlatformsIp(ip), true, ip);
  }
});

test("customer, cloud and malformed addresses are not Meta", () => {
  for (const ip of [
    "49.228.10.20", // Thai mobile carrier
    "171.97.1.1", // Thai fixed broadband
    "8.8.8.8",
    "52.95.110.1", // AWS
    "2001:4860:4860::8888",
    "2a03:2881::1", // adjacent to Meta's /32 but outside it
    "",
    "unknown",
    "157.240.22",
  ]) {
    assert.equal(isMetaPlatformsIp(ip), false, ip);
  }
  assert.equal(isMetaPlatformsIp(null), false);
  assert.equal(isMetaPlatformsIp(undefined), false);
});
