import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, map, of, switchMap, tap } from 'rxjs';
import type { IndexingProgress, Repo } from '../../types';
import { CreateRepoBody } from '@api/CreateRepoBody';

@Component({
  selector: "app-repo-list",
  imports: [RouterLink],
  templateUrl: "./repo-list.component.html",
  styleUrl: "./repo-list.component.css",
})
export class RepoListComponent {
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);

  name = signal("");
  gitPath = signal("");
  pathPlaceholder = computed(() => this.sourceType() === "local" ? "Path to local repo" : "Git URL, e.g. https://github.com/org/repo.git")
  sourceType = signal<"local" | "remote">("local");
  error = signal("");

  /** True while POST /api/repos is in-flight. */
  adding = signal(false);

  /** Map of repoName → latest IndexingProgress for repos being indexed. */
  progressByRepo = signal<Record<string, IndexingProgress>>({});

  repos = httpResource<Repo[]>(() => "/api/repos");

  /** Normalized host suffixes that have a GIT_TOKEN_* env var on the server. */
  private configuredHosts = httpResource<string[]>(() => "/api/git-credentials/hosts");

  /**
   * Live token status for the URL currently typed in the remote URL input.
   * Returns 'ok' | 'missing' | null (null = no valid URL typed yet).
   */
  remoteUrlTokenStatus = computed<"ok" | "missing" | null>(() => {
    const gitPath = this.gitPath();
    if (!gitPath || !gitPath.includes("://")) return null;
    try {
      const host = new URL(gitPath).hostname.toLowerCase();
      if (!host) return null;
      const suffix = host.replace(/[.\-]/g, "_").toUpperCase();
      const hosts = this.configuredHosts.value();
      if (!hosts) return null;
      return hosts.includes(suffix) ? "ok" : "missing";
    } catch {
      return null;
    }
  });

  canSubmit = computed(() => this.name() && this.gitPath());

  /** True when any repo is currently cloning its mirror. */
  hasCloning = computed(() => {
    const list = this.repos.value();
    return list?.some((r) => r.mirrorStatus === "cloning") ?? false;
  });

  constructor() {

    effect(() => {
      const gitPath = this.gitPath();
      const name = this.name();
      const hasDotGit = gitPath?.endsWith(".git");
      if(gitPath && hasDotGit && !name) {
        const repoName = gitPath.split("/").at(-1)?.replace(".git", "") ?? "";
        this.name.set(repoName);
      }
    })
    // Poll indexing-status every 2s and map to per-repo progress.
    // Also reload the repos list when any repo is cloning or when
    // an indexing job just finished.
    interval(2000).pipe(
      takeUntilDestroyed(this.destroyRef),
      switchMap(() =>
        this.http.get<IndexingProgress[]>("/api/indexing-status").pipe(
          catchError(() => of([] as IndexingProgress[])),
        ),
      ),
      map((list) => {
        const byRepo: Record<string, IndexingProgress> = {};
        for (const p of list) {
          // Keep the most "active" entry per repo
          if (!byRepo[p.repo] || p.stage !== "ready") {
            byRepo[p.repo] = p;
          }
        }
        return byRepo;
      }),
      tap((byRepo) => {
        const prev = this.progressByRepo();
        this.progressByRepo.set(byRepo);

        // If any repo just finished indexing, reload the list
        const justFinished = Object.keys(prev).some(
          (name) => prev[name]?.stage !== "ready" && prev[name]?.stage !== "error"
            && (byRepo[name]?.stage === "ready" || byRepo[name]?.stage === "error" || !byRepo[name]),
        );

        // Also reload while any repo is still cloning its mirror
        if (justFinished || this.hasCloning()) {
          this.repos.reload();
        }
      }),
    ).subscribe();
  }

  progressForRepo(repoName: string): IndexingProgress | undefined {
    const p = this.progressByRepo()[repoName];
    if (p && p.stage !== "ready" && p.stage !== "error") return p;
    return undefined;
  }

  progressStageLabel(p: IndexingProgress): string {
    switch (p.stage) {
      case "syncing": return "Cloning…";
      case "resolving": return "Resolving…";
      case "checking-out": return "Checking out…";
      case "diffing": return "Computing diff…";
      case "processing-files":
        return p.filesTotal > 0
          ? `Processing ${p.filesProcessed}/${p.filesTotal} files…`
          : "Processing files…";
      case "embedding":
        return p.chunksTotal > 0
          ? `Embedding ${p.chunksEmbedded}/${p.chunksTotal} chunks…`
          : "Embedding…";
      case "finalizing": return "Finalizing…";
      default: return "Indexing…";
    }
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }


  addRepo(event: Event) {
    event.preventDefault();
    this.error.set("");
    const body: CreateRepoBody = { name: this.name() };
    if (this.sourceType() === "local") {
      body.localPath = this.gitPath();
    } else {
      body.remoteUrl = this.gitPath();
    }

    this.adding.set(true);

    this.http.post<Repo>("/api/repos", body).subscribe({
      next: () => {
        this.adding.set(false);
        this.name.set("");
        this.gitPath.set("");
        // Reload the list — the new repo will appear with mirrorStatus 'cloning'.
        // The polling loop will keep refreshing until the clone completes.
        this.repos.reload();
      },
      error: (err) => {
        this.adding.set(false);
        this.error.set(err.error?.error ?? "Failed to add repository.");
      },
    });
  }

  deleteRepo(name: string) {
    this.http.delete(`/api/repos/${name}`).subscribe({
      next: () => this.repos.reload(),
      error: (err) => this.error.set(err.error?.error ?? "Failed to delete."),
    });
  }

}
