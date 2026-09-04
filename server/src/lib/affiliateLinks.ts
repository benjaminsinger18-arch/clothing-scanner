// Opt-in outbound-link tagging for affiliate/revenue-share programs (e.g. eBay
// Partner Network, or a Rakuten/Skimlinks/Sovrn-style network for the resale
// marketplaces this app now recognizes — see serpApiClient.ts's
// RESALE_MARKETPLACE_DOMAINS). This module is inert by default: there is no
// monetization happening in this app today (no business-model docs anywhere
// in this repo), and nothing here changes a listing's price or destination —
// it only appends the query string a given program's own dashboard tells you
// to use, and only for a domain you've actually enrolled in and configured
// via an env var. Unconfigured domains pass through untouched. This is the
// plumbing for a future revenue path, not a live one.

/** Maps a listing's outbound domain to the env var that holds its affiliate
 * query string, e.g. `AFFILIATE_TAG_EBAY="campid=XXXXX&customid=clothingscanner"`
 * (eBay Partner Network's raw tracking-param format — stored as a whole query
 * string rather than a single key/value pair, since different programs use
 * different param names and some need more than one). Add a domain here once
 * you've enrolled in its program; until its env var is set, matching listings
 * are left untouched. */
const DOMAIN_ENV_KEYS: Record<string, string> = {
  "ebay.com": "AFFILIATE_TAG_EBAY",
  "poshmark.com": "AFFILIATE_TAG_POSHMARK",
  "thredup.com": "AFFILIATE_TAG_THREDUP",
  "therealreal.com": "AFFILIATE_TAG_THEREALREAL",
  "depop.com": "AFFILIATE_TAG_DEPOP",
  "grailed.com": "AFFILIATE_TAG_GRAILED",
};

function matchDomainKey(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const domain of Object.keys(DOMAIN_ENV_KEYS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}

/** Appends a configured affiliate query string to `url` if its domain has one
 * set, via the matching env var — returns `url` unchanged for every domain
 * without one configured, which today is all of them out of the box. Never
 * throws on a malformed url; a broken outbound listing link is worse than an
 * untagged one. */
export function applyAffiliateTag(url: string): string {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const domainKey = matchDomainKey(parsed.hostname);
  if (!domainKey) return url;

  const rawTag = process.env[DOMAIN_ENV_KEYS[domainKey]];
  if (!rawTag) return url;

  for (const [key, value] of new URLSearchParams(rawTag)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}
