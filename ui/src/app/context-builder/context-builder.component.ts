import { Component, inject, signal, computed } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HttpClient, httpResource } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import type { ContextPackResult, GitRefs, Repo } from "../types";
import { HighlightPipe } from "../shared/highlight.pipe";
import { RefPickerComponent } from "../shared/ref-picker/ref-picker.component";

@Component({
  selector: "app-context-builder",
  imports: [RouterLink, HighlightPipe, RefPickerComponent],
  templateUrl: "./context-builder.component.html",
  styleUrl: "./context-builder.component.css",
})
export class ContextBuilderComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  private params = toSignal(this.route.paramMap.pipe(
    map((p) => p.get("name") ?? ""),
  ), { initialValue: "" });

  repoName = computed(() => this.params());

  /** Full repo data including indexed refs with their stages. */
  private repo = httpResource<Repo>(() => {
    const name = this.repoName();
    return name ? `/api/repos/${name}` : undefined;
  });

  /** Raw git refs from the mirror (branches + tags). */
  private gitRefs = httpResource<GitRefs>(() => {
    const name = this.repoName();
    return name ? `/api/repos/${name}/git-refs` : undefined;
  });

  /**
   * Git refs filtered to only those that have been indexed (stage "ready").
   * The ref-picker receives this so users can only select usable refs.
   */
  indexedGitRefs = computed<GitRefs | undefined>(() => {
    const repo = this.repo.value();
    const refs = this.gitRefs.value();
    if (!repo || !refs) return undefined;

    const readyRefs = new Set(
      repo.refs.filter((r) => r.stage === "ready").map((r) => r.ref),
    );

    return {
      branches: refs.branches.filter((b) => readyRefs.has(b)),
      tags: refs.tags.filter((t) => readyRefs.has(t)),
    };
  });

  /** True when repo data loaded but no refs have been indexed yet. */
  noIndexedRefs = computed(() => {
    const repo = this.repo.value();
    if (!repo) return false;
    return !repo.refs.some((r) => r.stage === "ready");
  });

  strategy = signal("explain");
  ref = signal("");
  fromRef = signal("");
  query = signal("");
  maxTokens = signal("");
  loading = signal(false);
  error = signal("");
  result = signal<ContextPackResult | null>(null);

  asValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  build(event: Event) {
    event.preventDefault();
    this.loading.set(true);
    this.error.set("");
    this.result.set(null);

    const body: Record<string, unknown> = {
      strategy: this.strategy(),
    };
    if (this.ref()) body["ref"] = this.ref();
    if (this.fromRef()) body["fromRef"] = this.fromRef();
    if (this.query()) body["query"] = this.query();
    if (this.maxTokens()) body["maxTokens"] = parseInt(this.maxTokens(), 10);

    const name = this.repoName();

    this.http.post<ContextPackResult>(`/api/repos/${name}/context`, body).subscribe({
      next: (data) => {
        this.result.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error ?? "Failed to build context pack.");
        this.loading.set(false);
      },
    });
  }

  copyFormatted() {
    const r = this.result();
    if (r?.formatted) {
      navigator.clipboard.writeText(r.formatted).catch(() => {});
    }
  }
}
