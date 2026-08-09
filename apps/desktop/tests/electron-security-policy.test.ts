/**
 * A8 (GATE-3.5 wave 1) — unit tests for the pure Electron security policy
 * (R40/R42): scheme blocking, local/private destination detection,
 * allowlist semantics, navigation decisions, YouTube origin enumeration,
 * local-doc path resolution. No electron imports — runs in the node env.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKED_NAVIGATION_SCHEMES,
  DEFAULT_REMOTE_ALLOWLIST,
  YOUTUBE_EMBED_ORIGINS,
  decideRemoteNavigation,
  hostMatchesAllowlist,
  isLocalOrPrivateHost,
  resolveLocalDocPath,
} from "../electron/security-policy";

const ALLOW = DEFAULT_REMOTE_ALLOWLIST;

describe("hostMatchesAllowlist (pre-A8 semantics preserved)", () => {
  it("matches exact hosts and subdomains for plain entries", () => {
    expect(hostMatchesAllowlist("youtube.com", ["youtube.com"])).toBe(true);
    expect(hostMatchesAllowlist("www.youtube.com", ["youtube.com"])).toBe(true);
    expect(hostMatchesAllowlist("evil-youtube.com", ["youtube.com"])).toBe(false);
    expect(hostMatchesAllowlist("youtube.com.evil.example", ["youtube.com"])).toBe(false);
  });

  it("wildcard entries match subdomains but NOT the bare domain", () => {
    expect(hostMatchesAllowlist("www.youtube.com", ["*.youtube.com"])).toBe(true);
    expect(hostMatchesAllowlist("consent.youtube.com", ["*.youtube.com"])).toBe(true);
    expect(hostMatchesAllowlist("youtube.com", ["*.youtube.com"])).toBe(false);
  });

  it("is case-insensitive on the host", () => {
    expect(hostMatchesAllowlist("WWW.YOUTUBE.COM", ["youtube.com"])).toBe(true);
  });
});

describe("isLocalOrPrivateHost — IPv4", () => {
  it("flags RFC1918, loopback, link-local, CGNAT and reserved ranges", () => {
    expect(isLocalOrPrivateHost("10.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("172.16.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("172.31.255.255")).toBe(true);
    expect(isLocalOrPrivateHost("172.32.0.1")).toBe(false);
    expect(isLocalOrPrivateHost("192.168.1.1")).toBe(true);
    expect(isLocalOrPrivateHost("127.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("127.255.255.254")).toBe(true);
    expect(isLocalOrPrivateHost("169.254.169.254")).toBe(true); // metadata endpoint
    expect(isLocalOrPrivateHost("100.64.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("100.127.255.255")).toBe(true);
    expect(isLocalOrPrivateHost("100.128.0.1")).toBe(false);
    expect(isLocalOrPrivateHost("0.0.0.0")).toBe(true);
    expect(isLocalOrPrivateHost("224.0.0.1")).toBe(true); // multicast
    expect(isLocalOrPrivateHost("255.255.255.255")).toBe(true);
    expect(isLocalOrPrivateHost("192.0.2.1")).toBe(true); // TEST-NET
    expect(isLocalOrPrivateHost("198.18.0.1")).toBe(true); // benchmarking
  });

  it("allows public addresses", () => {
    expect(isLocalOrPrivateHost("8.8.8.8")).toBe(false);
    expect(isLocalOrPrivateHost("1.1.1.1")).toBe(false);
    expect(isLocalOrPrivateHost("93.184.216.34")).toBe(false);
  });

  it("rejects malformed IP literals (treated as names, not private)", () => {
    expect(isLocalOrPrivateHost("999.1.1.1")).toBe(false);
    expect(isLocalOrPrivateHost("1.2.3")).toBe(false);
    expect(isLocalOrPrivateHost("1.2.3.4.5")).toBe(false);
  });
});

describe("isLocalOrPrivateHost — IPv6 and local names", () => {
  it("flags loopback, ULA, link-local, multicast, documentation and mapped ranges", () => {
    expect(isLocalOrPrivateHost("::1")).toBe(true);
    expect(isLocalOrPrivateHost("::")).toBe(true);
    expect(isLocalOrPrivateHost("fd00::1")).toBe(true);
    expect(isLocalOrPrivateHost("fcff::1")).toBe(true);
    expect(isLocalOrPrivateHost("fe80::1")).toBe(true);
    expect(isLocalOrPrivateHost("fec0::1")).toBe(true); // deprecated site-local
    expect(isLocalOrPrivateHost("ff02::1")).toBe(true);
    expect(isLocalOrPrivateHost("2001:db8::1")).toBe(true); // documentation
    expect(isLocalOrPrivateHost("::ffff:127.0.0.1")).toBe(true); // mapped loopback
    expect(isLocalOrPrivateHost("::ffff:192.168.0.1")).toBe(true); // mapped RFC1918
  });

  it("allows public IPv6", () => {
    expect(isLocalOrPrivateHost("2606:4700:4700::1111")).toBe(false);
    expect(isLocalOrPrivateHost("2001:4860:4860::8888")).toBe(false);
  });

  it("flags well-known local names", () => {
    expect(isLocalOrPrivateHost("localhost")).toBe(true);
    expect(isLocalOrPrivateHost("myhost.localhost")).toBe(true);
    expect(isLocalOrPrivateHost("printer.local")).toBe(true);
    expect(isLocalOrPrivateHost("router.lan")).toBe(true);
    expect(isLocalOrPrivateHost("intranet.internal")).toBe(true);
    expect(isLocalOrPrivateHost("www.youtube.com")).toBe(false);
  });
});

describe("decideRemoteNavigation (R40)", () => {
  it("allows allowlisted public https destinations", () => {
    expect(decideRemoteNavigation("https://www.youtube.com/watch?v=dQw4w9WgXcQ", ALLOW).allowed).toBe(true);
    expect(decideRemoteNavigation("https://es.wikipedia.org/wiki/Don_Quijote", ALLOW).allowed).toBe(true);
  });

  it("blocks dangerous schemes regardless of allowlist", () => {
    for (const scheme of ["file:", "javascript:", "data:", "blob:", "chrome:", "chrome-extension:", "devtools:", "ws:", "wss:", "arsvox-doc:"]) {
      const d = decideRemoteNavigation(`${scheme}//example.com/x`, ALLOW);
      expect(d.allowed).toBe(false);
      expect(d.reason.startsWith("blocked-scheme:")).toBe(true);
    }
    // a file: URL pointing at an allowlisted host is still blocked
    expect(decideRemoteNavigation("file://youtube.com/index.html", ALLOW).allowed).toBe(false);
  });

  it("allows only about:blank from the about: scheme", () => {
    expect(decideRemoteNavigation("about:blank", ALLOW).allowed).toBe(true);
    expect(decideRemoteNavigation("about:config", ALLOW).allowed).toBe(false);
  });

  it("blocks unparseable URLs", () => {
    expect(decideRemoteNavigation("not a url", ALLOW).allowed).toBe(false);
  });

  it("blocks non-allowlisted public hosts", () => {
    const d = decideRemoteNavigation("https://example.com/", ALLOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("not-allowlisted");
  });

  it("blocks local/private destinations EVEN when allowlisted (R40)", () => {
    const withLocal = [...ALLOW, "localhost", "127.0.0.1", "192.168.0.10"];
    expect(decideRemoteNavigation("http://localhost:8765/", withLocal).allowed).toBe(false);
    expect(decideRemoteNavigation("http://127.0.0.1:8765/", withLocal).allowed).toBe(false);
    expect(decideRemoteNavigation("http://192.168.0.10/", withLocal).allowed).toBe(false);
    expect(decideRemoteNavigation("http://10.0.0.5/", withLocal).allowed).toBe(false);
  });

  it("blocks local-doc protocol for remote content", () => {
    expect(decideRemoteNavigation("arsvox-doc://docs/book.epub", ALLOW).allowed).toBe(false);
  });
});

describe("YOUTUBE_EMBED_ORIGINS (R42 enumeration)", () => {
  it("covers the registrable domains the allowlist needs", () => {
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://www.youtube.com");
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://www.youtube-nocookie.com");
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://consent.youtube.com");
  });

  it("documents that youtube-nocookie.com is missing from the config default", () => {
    // R42 finding: DEFAULT_REMOTE_ALLOWLIST lacks the nocookie domain.
    expect(DEFAULT_REMOTE_ALLOWLIST.some((e) => e.includes("nocookie"))).toBe(false);
  });
});

describe("resolveLocalDocPath (custom protocol over file:)", () => {
  const roots = { docs: "/srv/library", media: "/srv/media" };

  it("resolves a plain path within a known alias", () => {
    expect(resolveLocalDocPath("docs", "/books/quijote.epub", roots)).toEqual({
      root: "/srv/library",
      relative: "books/quijote.epub",
    });
  });

  it("rejects unknown aliases, empty paths and traversal", () => {
    expect(resolveLocalDocPath("other", "/a.txt", roots)).toBeNull();
    expect(resolveLocalDocPath("docs", "/", roots)).toBeNull();
    expect(resolveLocalDocPath("docs", "/../etc/passwd", roots)).toBeNull();
    expect(resolveLocalDocPath("docs", "/books/../../etc/passwd", roots)).toBeNull();
    expect(resolveLocalDocPath("docs", "/books/%2e%2e/secret", roots)).not.toBeNull(); // encoded dots are a filename here — handler realpath check covers escapes
  });

  it("is alias case-insensitive", () => {
    expect(resolveLocalDocPath("DOCS", "/a.txt", roots)).not.toBeNull();
  });
});

describe("BLOCKED_NAVIGATION_SCHEMES", () => {
  it("contains every dangerous scheme the decision logic relies on", () => {
    for (const s of ["file:", "javascript:", "data:", "blob:", "chrome:", "chrome-extension:", "devtools:", "about:", "arsvox-doc:", "ws:", "wss:"]) {
      expect(BLOCKED_NAVIGATION_SCHEMES.has(s)).toBe(true);
    }
  });
});
