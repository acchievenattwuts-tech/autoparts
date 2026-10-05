import { BlockList, isIP } from "node:net";

/**
 * Address space announced by Meta Platforms (AS32934), from RIPEstat
 * `announced-prefixes?resource=AS32934`, retrieved 2026-10-05 and reduced to the
 * covering prefixes (more-specifics dropped).
 *
 * Why it exists: Meta's ad-review / link-check crawler renders storefront pages in
 * headless Chrome with an ordinary desktop Chrome user agent, so user-agent bot checks
 * miss it. On 2026-10-03 it opened ~880 product pages in two hours and became 192 of
 * the day's 209 "visitors" in StorefrontVisitDaily. Real customers who open links inside
 * the Facebook / Messenger in-app browser connect from their own ISP, not from these
 * ranges, so filtering them does not drop real visits.
 *
 * Only for analytics filtering. Never use it to block requests — the shop runs Facebook
 * ads and Meta must be able to review the landing pages. Refresh the list from the same
 * RIPEstat endpoint if Meta-originated visits reappear in the visitor stats.
 */
export const META_PLATFORMS_IPV4_PREFIXES = [
  "31.13.24.0/21",
  "31.13.64.0/18",
  "45.64.40.0/22",
  "57.141.0.0/24",
  "57.141.2.0/24",
  "57.141.3.0/24",
  "57.141.4.0/24",
  "57.141.5.0/24",
  "57.141.6.0/24",
  "57.141.8.0/24",
  "57.141.10.0/24",
  "57.141.12.0/24",
  "57.141.13.0/24",
  "57.141.14.0/24",
  "57.141.16.0/24",
  "57.141.17.0/24",
  "57.141.18.0/24",
  "57.141.19.0/24",
  "57.141.20.0/24",
  "57.141.22.0/24",
  "57.141.24.0/24",
  "57.144.0.0/14",
  "66.220.144.0/20",
  "69.63.176.0/20",
  "69.171.224.0/19",
  "74.119.76.0/22",
  "102.132.96.0/20",
  "103.4.96.0/22",
  "129.134.0.0/17",
  "157.240.0.0/17",
  "157.240.192.0/18",
  "163.70.128.0/17",
  "163.77.132.0/23",
  "163.77.136.0/23",
  "163.77.160.0/20",
  "173.252.64.0/19",
  "173.252.96.0/19",
  "179.60.192.0/22",
  "185.60.216.0/22",
  "185.89.216.0/22",
  "204.15.20.0/22",
] as const;

export const META_PLATFORMS_IPV6_PREFIXES = ["2a03:2880::/32", "2620:0:1c00::/40"] as const;

let metaBlockList: BlockList | null = null;

const getMetaBlockList = (): BlockList => {
  if (metaBlockList) return metaBlockList;
  const list = new BlockList();
  for (const prefix of META_PLATFORMS_IPV4_PREFIXES) {
    const [network, length] = prefix.split("/");
    list.addSubnet(network, Number(length), "ipv4");
  }
  for (const prefix of META_PLATFORMS_IPV6_PREFIXES) {
    const [network, length] = prefix.split("/");
    list.addSubnet(network, Number(length), "ipv6");
  }
  metaBlockList = list;
  return list;
};

/** True when `ip` (IPv4, IPv6 or IPv4-mapped IPv6) belongs to Meta Platforms' network. */
export const isMetaPlatformsIp = (ip: string | null | undefined): boolean => {
  const candidate = (ip ?? "").trim().replace(/^::ffff:/i, "");
  const family = isIP(candidate);
  if (family === 4) return getMetaBlockList().check(candidate, "ipv4");
  if (family === 6) return getMetaBlockList().check(candidate, "ipv6");
  return false;
};
