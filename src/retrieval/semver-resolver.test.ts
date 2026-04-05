import { describe, it, expect } from "vitest";
import { resolveSemver } from "./semver-resolver.js";

const TAGS = ["v1.0.0", "v1.1.0", "v1.2.3", "v2.0.0", "v2.1.0", "v1.0.0-beta.1"];

describe("Semver Resolver", () => {
  it("resolves exact version (1.2.3) to matching indexed tag", () => {
    expect(resolveSemver("1.2.3", TAGS)).toBe("v1.2.3");
  });

  it("resolves caret range (^1.2.0) to highest compatible tag", () => {
    // ^1.2.0 matches >=1.2.0 <2.0.0 → v1.2.3 (highest in 1.x)
    expect(resolveSemver("^1.2.0", TAGS)).toBe("v1.2.3");
  });

  it("resolves tilde range (~1.0.0) to highest patch-level tag", () => {
    // ~1.0.0 matches >=1.0.0 <1.1.0 → v1.0.0
    expect(resolveSemver("~1.0.0", TAGS)).toBe("v1.0.0");
  });

  it("resolves x-range (1.x) to highest matching tag", () => {
    // 1.x matches >=1.0.0 <2.0.0 → v1.2.3
    expect(resolveSemver("1.x", TAGS)).toBe("v1.2.3");
  });

  it("returns null when no indexed tag satisfies the constraint", () => {
    expect(resolveSemver("^3.0.0", TAGS)).toBeNull();
  });

  it("falls back to null when ref is not semver (e.g. 'main')", () => {
    expect(resolveSemver("main", TAGS)).toBeNull();
  });

  it("handles pre-release tags correctly (1.0.0-beta.1)", () => {
    // Exact pre-release match
    expect(resolveSemver("1.0.0-beta.1", TAGS)).toBe("v1.0.0-beta.1");
    // Caret range ^1.0.0-beta.0 matches >=1.0.0-beta.0 <2.0.0 — stable releases win
    expect(resolveSemver("^1.0.0-beta.0", TAGS)).toBe("v1.2.3");
    // Pre-release only candidates
    expect(resolveSemver("^1.0.0-beta.0", ["v1.0.0-beta.1"])).toBe("v1.0.0-beta.1");
  });

  it("sorts candidates by semver descending to pick the best match", () => {
    // >=2.0.0 should pick the highest: v2.1.0 over v2.0.0
    expect(resolveSemver(">=2.0.0", TAGS)).toBe("v2.1.0");
  });
});
