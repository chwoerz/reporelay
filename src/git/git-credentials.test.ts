import { describe, it, expect } from "vitest";
import { normalizeHost, resolveGitAuth } from "./git-credentials.js";

describe("normalizeHost", () => {
  it("replaces dots with underscores and uppercases", () => {
    expect(normalizeHost("github.com")).toBe("GITHUB_COM");
  });

  it("replaces hyphens with underscores", () => {
    expect(normalizeHost("my-gitlab.company.com")).toBe("MY_GITLAB_COMPANY_COM");
  });

  it("handles single-segment hostnames", () => {
    expect(normalizeHost("localhost")).toBe("LOCALHOST");
  });

  it("handles multiple dots and hyphens", () => {
    expect(normalizeHost("git.my-corp.internal.io")).toBe("GIT_MY_CORP_INTERNAL_IO");
  });

  it("handles already-uppercase input", () => {
    expect(normalizeHost("GITHUB.COM")).toBe("GITHUB_COM");
  });
});

describe("resolveGitAuth", () => {
  it("returns null for local filesystem paths", () => {
    const env = { GIT_TOKEN_LOCALHOST: "tok" };
    expect(resolveGitAuth("/home/user/repos/my-repo", env)).toBeNull();
  });

  it("returns null for relative paths", () => {
    const env = { GIT_TOKEN_LOCALHOST: "tok" };
    expect(resolveGitAuth("../some-repo", env)).toBeNull();
  });

  it("returns null for SSH URLs", () => {
    const env = { GIT_TOKEN_GITHUB_COM: "tok" };
    expect(resolveGitAuth("ssh://git@github.com/org/repo.git", env)).toBeNull();
  });

  it("returns null for git:// protocol URLs", () => {
    const env = { GIT_TOKEN_GITHUB_COM: "tok" };
    expect(resolveGitAuth("git://github.com/org/repo.git", env)).toBeNull();
  });

  it("returns null when no token env var is set for the host", () => {
    const env = {};
    expect(resolveGitAuth("https://github.com/org/repo.git", env)).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(resolveGitAuth("not a url at all://broken", {})).toBeNull();
  });

  it("uses x-access-token for github.com", () => {
    const env = { GIT_TOKEN_GITHUB_COM: "ghp_abc123" };
    const auth = resolveGitAuth("https://github.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toBe(
      "https://x-access-token:ghp_abc123@github.com/org/repo.git",
    );
    expect(auth!.originalUrl).toBe("https://github.com/org/repo.git");
  });

  it("uses oauth2 for gitlab.com", () => {
    const env = { GIT_TOKEN_GITLAB_COM: "glpat-xyz789" };
    const auth = resolveGitAuth("https://gitlab.com/group/project.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toBe("https://oauth2:glpat-xyz789@gitlab.com/group/project.git");
  });

  it("uses x-token-auth for bitbucket.org", () => {
    const env = { GIT_TOKEN_BITBUCKET_ORG: "ATBBsecret" };
    const auth = resolveGitAuth("https://bitbucket.org/team/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toBe(
      "https://x-token-auth:ATBBsecret@bitbucket.org/team/repo.git",
    );
  });

  it("falls back to oauth2 for unknown hosts", () => {
    const env = { GIT_TOKEN_GITEA_MYCOMPANY_COM: "tok_123" };
    const auth = resolveGitAuth("https://gitea.mycompany.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toBe("https://oauth2:tok_123@gitea.mycompany.com/org/repo.git");
  });

  it("uses GIT_USER_<HOST> override when set", () => {
    const env = {
      GIT_TOKEN_GITEA_MYCOMPANY_COM: "tok_123",
      GIT_USER_GITEA_MYCOMPANY_COM: "deploy-bot",
    };
    const auth = resolveGitAuth("https://gitea.mycompany.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toBe(
      "https://deploy-bot:tok_123@gitea.mycompany.com/org/repo.git",
    );
  });

  it("user override takes precedence over known-host defaults", () => {
    const env = {
      GIT_TOKEN_GITHUB_COM: "ghp_abc",
      GIT_USER_GITHUB_COM: "my-app[bot]",
    };
    const auth = resolveGitAuth("https://github.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    // Special chars in username should be percent-encoded
    expect(auth!.authenticatedUrl).toContain("my-app%5Bbot%5D:ghp_abc@github.com");
  });

  it("strips pre-existing credentials from originalUrl", () => {
    const env = { GIT_TOKEN_GITHUB_COM: "ghp_new" };
    const auth = resolveGitAuth("https://old-user:old-token@github.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.originalUrl).toBe("https://github.com/org/repo.git");
    expect(auth!.authenticatedUrl).toBe("https://x-access-token:ghp_new@github.com/org/repo.git");
  });

  it("preserves port numbers in URLs", () => {
    const env = { GIT_TOKEN_GITLAB_SELF_HOSTED_COM: "glpat-tok" };
    const auth = resolveGitAuth("https://gitlab.self-hosted.com:8443/org/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toContain(":8443/");
    expect(auth!.originalUrl).toContain(":8443/");
  });

  it("preserves query params and fragments", () => {
    const env = { GIT_TOKEN_EXAMPLE_COM: "tok" };
    const auth = resolveGitAuth("https://example.com/repo.git?ref=main", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toContain("?ref=main");
  });

  it("works with http:// URLs (not just https://)", () => {
    const env = { GIT_TOKEN_INTERNAL_GIT_COM: "tok" };
    const auth = resolveGitAuth("http://internal-git.com/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toMatch(/^http:\/\/oauth2:tok@internal-git\.com/);
  });

  it("percent-encodes special characters in tokens", () => {
    const env = { GIT_TOKEN_GITHUB_COM: "tok/with@special=chars" };
    const auth = resolveGitAuth("https://github.com/org/repo.git", env);

    expect(auth).not.toBeNull();
    // The token should be percent-encoded in the URL
    expect(auth!.authenticatedUrl).not.toContain("tok/with@special=chars");
    expect(auth!.authenticatedUrl).toContain(encodeURIComponent("tok/with@special=chars"));
  });

  it("handles hostnames with hyphens correctly", () => {
    const env = { GIT_TOKEN_MY_GITLAB_CORP_NET: "tok" };
    const auth = resolveGitAuth("https://my-gitlab.corp.net/team/repo.git", env);

    expect(auth).not.toBeNull();
    expect(auth!.authenticatedUrl).toContain("oauth2:tok@my-gitlab.corp.net");
  });
});
