/**
 * Unit tests for web app security helpers (CORS parsing, repo name validation).
 */
import { describe, it, expect } from "vitest";
import { parseCorsOrigin, validateRepoName } from "./app.js";

describe("parseCorsOrigin", () => {
  it("returns false when undefined (CORS disabled)", () => {
    expect(parseCorsOrigin(undefined)).toBe(false);
  });

  it("returns false when empty string", () => {
    expect(parseCorsOrigin("")).toBe(false);
    expect(parseCorsOrigin("  ")).toBe(false);
  });

  it("returns true when wildcard '*'", () => {
    expect(parseCorsOrigin("*")).toBe(true);
    expect(parseCorsOrigin(" * ")).toBe(true);
  });

  it("parses comma-separated origins into array", () => {
    expect(parseCorsOrigin("http://localhost:4200,https://app.example.com")).toEqual([
      "http://localhost:4200",
      "https://app.example.com",
    ]);
  });

  it("trims whitespace in origins", () => {
    expect(parseCorsOrigin(" http://a.com , http://b.com ")).toEqual([
      "http://a.com",
      "http://b.com",
    ]);
  });

  it("filters out empty segments", () => {
    expect(parseCorsOrigin("http://a.com,,http://b.com")).toEqual(["http://a.com", "http://b.com"]);
  });
});

describe("validateRepoName", () => {
  it("accepts valid repo names", () => {
    expect(validateRepoName("my-project")).toBeNull();
    expect(validateRepoName("reporelay")).toBeNull();
    expect(validateRepoName("org.example.app")).toBeNull();
    expect(validateRepoName("my_project-2")).toBeNull();
  });

  it("rejects names with forward slashes", () => {
    expect(validateRepoName("my/project")).toBeTruthy();
    expect(validateRepoName("/etc/passwd")).toBeTruthy();
  });

  it("rejects names with backslashes", () => {
    expect(validateRepoName("my\\project")).toBeTruthy();
  });

  it("rejects path traversal sequences", () => {
    expect(validateRepoName("..")).toBeTruthy();
    expect(validateRepoName(".")).toBeTruthy();
    expect(validateRepoName("../etc/passwd")).toBeTruthy();
  });

  it("accepts names with consecutive dots that are not standalone . or ..", () => {
    expect(validateRepoName("foo..bar")).toBeNull();
    expect(validateRepoName("my-project..v2")).toBeNull();
  });

  it("rejects names with control characters", () => {
    expect(validateRepoName("foo\x00bar")).toBeTruthy();
    expect(validateRepoName("foo\nbar")).toBeTruthy();
    expect(validateRepoName("foo\tbar")).toBeTruthy();
  });

  it("rejects names longer than 255 characters", () => {
    const longName = "a".repeat(256);
    expect(validateRepoName(longName)).toBeTruthy();
  });

  it("accepts names exactly 255 characters", () => {
    const maxName = "a".repeat(255);
    expect(validateRepoName(maxName)).toBeNull();
  });
});
