/**
 * A8 (GATE-3.5 wave 1) / W2-VIEW (GATE-5) — Electron security policy
 * primitives (R40/R41/R42).
 *
 * Pure URL/host/scheme/IP logic with NO electron imports so the whole
 * policy surface is unit-testable under vitest (node env). The Electron
 * glue lives in ./hardened-view.ts.
 *
 * Design rules (frozen in docs/consolidation-contract-2026-08-08.md, R40):
 *  - Remote content is untrusted data. Deny by default.
 *  - Navigation is filtered INDEPENDENTLY of the domain allowlist:
 *    dangerous schemes and local/private-network destinations are blocked
 *    even when the host matches an allowlist entry.
 *  - The allowlist here mirrors configs/app.yaml browser.allowlist
 *    (Electron does not read app.yaml); keep the two in sync.
 *
 * W2-VIEW (GATE-5, ADR 0007): this module is REINSTATED after 8d1fb3f
 * deleted it. The R42 allowlist gap is CLOSED — youtube-nocookie.com is
 * now in the default (docs/migration-note-electron-upgrade-2026-08-08.md
 * §4 + configs/app.yaml updated in the same lane).
 */

/** Partition for remote content — persist: prefix = persistent session. */
export const REMOTE_CONTENT_PARTITION = "persist:remote-content";

/** Custom application scheme for local documents (replaces permissive file:). */
export const LOCAL_DOC_SCHEME = "arsvox-doc";

/**
 * Content-Security-Policy injected for REMOTE pages (migration note §3,
 * exact policy): the view's documents may only load scripts/objects from
 * themselves or https, never inline objects, never unknown bases, and
 * forms may only submit to self/https. Injected via
 * session.webRequest.onHeadersReceived in createRemoteContentSession.
 */
export const REMOTE_CSP =
  "default-src 'self' https:; script-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'self' https:";

/**
 * Mirrors configs/app.yaml browser.allowlist default. W2-VIEW CLOSES the
 * R42 gap: youtube-nocookie.com + *.youtube-nocookie.com are REQUIRED by
 * the privacy-enhanced embed flow (www.youtube-nocookie.com) and are a
 * DIFFERENT registrable domain from youtube.com.
 */
export const DEFAULT_REMOTE_ALLOWLIST: readonly string[] = [
  "youtube.com",
  "*.youtube.com",
  "youtube-nocookie.com",
  "*.youtube-nocookie.com",
  "wikipedia.org",
  "openstreetmap.org",
];

/**
 * Schemes remote content may never navigate to. `about:blank` is allowed
 * explicitly (initial/empty documents); every other `about:` URL is
 * blocked. `arsvox-doc:` is app-only — remote pages must not be able to
 * pull local documents into the view.
 */
export const BLOCKED_NAVIGATION_SCHEMES: ReadonlySet<string> = new Set([
  "file:",
  "javascript:",
  "data:",
  "blob:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "about:",
  "arsvox-doc:",
  "ws:",
  "wss:",
]);

/**
 * Exact origin set the YouTube embed/player flow uses (R42 deliverable,
 * migration note §4). Host-level allowlist entries required:
 *   youtube.com, *.youtube.com            (covers www/m/music/consent)
 *   youtube-nocookie.com, *.youtube-nocookie.com   (privacy-enhanced embeds)
 * Both registrable domains are now in DEFAULT_REMOTE_ALLOWLIST.
 */
export const YOUTUBE_EMBED_ORIGINS: readonly string[] = [
  "https://www.youtube.com",
  "https://m.youtube.com",
  "https://music.youtube.com",
  "https://youtube.com",
  "https://consent.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://youtube-nocookie.com",
];

/** Host-level allowlist semantics — kept identical to the pre-A8 main.ts matcher. */
export function hostMatchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  // URL parsers lowercase hostnames, so matching is case-insensitive here.
  const h = host.toLowerCase();
  return allowlist.some((entry) => {
    if (entry.startsWith("*.")) return h.endsWith(entry.slice(1));
    return h === entry || h.endsWith(`.${entry}`);
  });
}

/* ------------------------------------------------------------------ */
/* Local / private network detection (defense-in-depth, allowlist-     */
/* independent per R40)                                                */
/* ------------------------------------------------------------------ */

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // "this network" (0.0.0.0/8)
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 address (with optional "::", embedded dotted-quad IPv4) to 8 groups. */
function parseIpv6(host: string): number[] | null {
  if (host.includes("%")) return null; // scope ids are link-local anyway
  const [head, tail] = host.split("::");
  const doubleColon = host.includes("::");
  const headGroups = head ? head.split(":") : [];
  let tailGroups: string[] = tail ? tail.split(":") : [];
  // Embedded IPv4 (e.g. ::ffff:127.0.0.1): last group is a dotted quad.
  if (tailGroups.length > 0 && tailGroups[tailGroups.length - 1].includes(".")) {
    const v4 = parseIpv4(tailGroups[tailGroups.length - 1]);
    if (!v4) return null;
    tailGroups = [
      ...tailGroups.slice(0, -1),
      ((v4[0] << 8) | v4[1]).toString(16), // hex, since groups are parsed as hex below
      ((v4[2] << 8) | v4[3]).toString(16),
    ];
  }
  const total = headGroups.length + tailGroups.length;
  if (doubleColon) {
    if (total > 7) return null;
  } else if (total !== 8) {
    return null;
  }
  const groups: number[] = [];
  const middle = doubleColon ? Array(8 - total).fill("0") : [];
  for (const g of [...headGroups, ...middle, ...tailGroups]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups;
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0, g1] = groups;
  const allZero = groups.every((g) => g === 0);
  const loopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  if (allZero) return true; // :: unspecified
  if (loopback) return true; // ::1 loopback
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  // IPv4-mapped (::ffff:a.b.c.d) — decode and apply IPv4 rules.
  if (g0 === 0 && g1 === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const octets = [(groups[6] >> 8) & 0xff, groups[6] & 0xff, (groups[7] >> 8) & 0xff, groups[7] & 0xff];
    return isPrivateIpv4(octets);
  }
  return false;
}

/**
 * True when `host` is a local/private-network destination: IP literals in
 * private/reserved ranges, IPv4-mapped IPv6, or well-known local names.
 * Blocks independently of the domain allowlist (R40).
 */
export function isLocalOrPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h) return false;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan")
  ) {
    return true;
  }
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  const v4 = parseIpv4(bare);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(bare);
  if (v6) return isPrivateIpv6(v6);
  return false;
}

/* ------------------------------------------------------------------ */
/* Navigation decision (R40)                                           */
/* ------------------------------------------------------------------ */

export interface NavigationDecision {
  allowed: boolean;
  /** Machine-readable reason, e.g. "blocked-scheme:file:" | "local-or-private" | "not-allowlisted". */
  reason: string;
}

/**
 * Decide whether a remote-content WebContents may navigate to `url`.
 * Order of checks (all independent of the allowlist except the last):
 *  1. unparseable URL            -> deny
 *  2. dangerous scheme           -> deny (about:blank exempt)
 *  3. non-http(s) scheme         -> deny
 *  4. local/private destination  -> deny
 *  5. allowlist membership       -> deny if absent
 */
export function decideRemoteNavigation(url: string, allowlist: readonly string[]): NavigationDecision {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { allowed: false, reason: "unparseable-url" };
  }
  const scheme = u.protocol; // includes ":"
  if (scheme === "about:") {
    return u.href === "about:blank"
      ? { allowed: true, reason: "ok" }
      : { allowed: false, reason: "blocked-scheme:about:" };
  }
  if (BLOCKED_NAVIGATION_SCHEMES.has(scheme)) {
    return { allowed: false, reason: `blocked-scheme:${scheme}` };
  }
  if (scheme !== "http:" && scheme !== "https:") {
    return { allowed: false, reason: `blocked-scheme:${scheme}` };
  }
  if (!u.hostname) return { allowed: false, reason: "no-host" };
  if (isLocalOrPrivateHost(u.hostname)) {
    return { allowed: false, reason: "local-or-private" };
  }
  if (!hostMatchesAllowlist(u.hostname, allowlist)) {
    return { allowed: false, reason: "not-allowlisted" };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Deny-by-default permission policy for remote content: NOTHING is ever
 * granted, including media. (The app's own window keeps its scoped media
 * grant in main.ts; remote content gets none.)
 */
export function isAllowedRemotePermission(_permission: string): boolean {
  return false;
}

/* ------------------------------------------------------------------ */
/* Local document protocol path resolution (R40: custom protocol over  */
/* permissive file:)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve `arsvox-doc://<alias>/<path>` against the registered roots.
 * Returns null when the alias is unknown, the path is empty, or any path
 * segment is ".." (traversal). The Electron handler additionally verifies
 * realpath containment (symlink escape) before serving.
 */
export function resolveLocalDocPath(
  host: string,
  pathname: string,
  roots: Readonly<Record<string, string>>,
): { root: string; relative: string } | null {
  const root = roots[host.toLowerCase()];
  if (!root) return null;
  const segments = pathname.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "..")) return null;
  return { root, relative: segments.join("/") };
}
