/**
 * A8 (GATE-3.5 wave 1) / W2-VIEW (GATE-5) — unit tests for the pure
 * Electron security policy (R40/R42): scheme blocking, local/private
 * destination detection, allowlist semantics, navigation decisions,
 * YouTube origin enumeration, remote CSP, local-doc path resolution.
 * No electron imports — runs in the node env.
 *
 * W2-VIEW: reinstated after 8d1fb3f deleted the module; the R42
 * youtube-nocookie gap test now asserts the gap is CLOSED (ADR 0007).
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKED_NAVIGATION_SCHEMES,
  REMOTE_CSP,
  YOUTUBE_EMBED_ORIGINS,
  decideRemoteNavigation,
  isLocalOrPrivateHost,
  resolveLocalDocPath,
} from "../electron/security-policy";

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
  it("allows public https destinations — no domain allowlist", () => {
    expect(decideRemoteNavigation("https://www.youtube.com/watch?v=dQw4w9WgXcQ").allowed).toBe(true);
    expect(decideRemoteNavigation("https://es.wikipedia.org/wiki/Don_Quijote").allowed).toBe(true);
    expect(decideRemoteNavigation("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ").allowed).toBe(true);
    expect(decideRemoteNavigation("https://example.com/").allowed).toBe(true);
    expect(decideRemoteNavigation("https://duckduckgo.com/?q=pasta").allowed).toBe(true);
  });

  it("blocks dangerous schemes", () => {
    for (const scheme of ["file:", "javascript:", "data:", "blob:", "chrome:", "chrome-extension:", "devtools:", "ws:", "wss:", "arsvox-doc:"]) {
      const d = decideRemoteNavigation(`${scheme}//example.com/x`);
      expect(d.allowed).toBe(false);
      expect(d.reason.startsWith("blocked-scheme:")).toBe(true);
    }
    // a file: URL pointing at a public host is still blocked
    expect(decideRemoteNavigation("file://youtube.com/index.html").allowed).toBe(false);
  });

  it("allows only about:blank from the about: scheme", () => {
    expect(decideRemoteNavigation("about:blank").allowed).toBe(true);
    expect(decideRemoteNavigation("about:config").allowed).toBe(false);
  });

  it("blocks unparseable URLs", () => {
    expect(decideRemoteNavigation("not a url").allowed).toBe(false);
  });

  it("blocks local/private destinations (R40)", () => {
    expect(decideRemoteNavigation("http://localhost:8765/").allowed).toBe(false);
    expect(decideRemoteNavigation("http://127.0.0.1:8765/").allowed).toBe(false);
    expect(decideRemoteNavigation("http://192.168.0.10/").allowed).toBe(false);
    expect(decideRemoteNavigation("http://10.0.0.5/").allowed).toBe(false);
  });

  it("blocks local-doc protocol for remote content", () => {
    expect(decideRemoteNavigation("arsvox-doc://docs/book.epub").allowed).toBe(false);
  });
});

describe("YOUTUBE_EMBED_ORIGINS (R42 enumeration)", () => {
  it("covers the registrable domains the embed flow needs", () => {
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://www.youtube.com");
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://www.youtube-nocookie.com");
    expect(YOUTUBE_EMBED_ORIGINS).toContain("https://consent.youtube.com");
  });

  it("R42 gap moot under the open policy (W2-VIEW): the nocookie embed origin navigates without any allowlist", () => {
    // The spike recorded the gap: DEFAULT_REMOTE_ALLOWLIST lacked the
    // nocookie domain. The navigation policy now has NO allowlist, so
    // every public origin — including youtube-nocookie.com — navigates.
    expect(decideRemoteNavigation("https://www.youtube-nocookie.com/embed/x").allowed).toBe(true);
  });
});

describe("REMOTE_CSP (migration note §3, lands with the upgrade)", () => {
  it("is the exact policy the migration note prescribes", () => {
    expect(REMOTE_CSP).toBe(
      "default-src 'self' https:; script-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'self' https:",
    );
  });

  it("constrains scripts/objects/forms but keeps https content loadable", () => {
    expect(REMOTE_CSP).toContain("script-src 'self' https:");
    expect(REMOTE_CSP).toContain("object-src 'none'");
    expect(REMOTE_CSP).toContain("base-uri 'none'");
    expect(REMOTE_CSP).toContain("form-action 'self' https:");
    expect(REMOTE_CSP).toContain("default-src 'self' https:");
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
