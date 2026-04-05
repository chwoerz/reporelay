import { Component, computed, DestroyRef, effect, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HttpClient, httpResource } from "@angular/common/http";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";
import { catchError, filter, interval, map, of, switchMap, tap } from "rxjs";
import type { GitRefs, IndexingProgress, Repo, RepoRef } from "../../types";
import { indexingStageEnum } from "../../types";
import { RefPickerComponent } from "../../shared/ref-picker/ref-picker.component";
import { ProgressCardComponent } from "../../shared/progress-card/progress-card.component";

/** Stages that indicate indexing is actively in progress (not terminal). */
const ACTIVE_STAGES: Set<string> = new Set(
  Object.values(indexingStageEnum).filter((s) => s !== "ready" && s !== "error"),
);

@Component({
  selector: "app-repo-detail",
  imports: [RouterLink, RefPickerComponent, ProgressCardComponent],
  templateUrl: "./repo-detail.component.html",
  styleUrl: "./repo-detail.component.css",
})
export class RepoDetailComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  private routeName = toSignal(this.route.paramMap.pipe(map((p) => p.get("name")!)), { initialValue: "" });

  syncRef = signal("");
  message = signal("");
  messageIsError = signal(false);

  /** Force polling right after sync, before the repo data reflects the indexing status. */
  private forcePolling = signal(false);

  /** Map of ref → latest IndexingProgress (only for actively indexing refs). */
  progressMap = signal<Record<string, IndexingProgress>>({});

  /**
   * Progress entries for refs that are actively indexing but haven't appeared
   * in the refs table yet (or the table is empty). Covers the gap between
   * clicking Sync and the worker creating the DB row.
   */
  pendingProgress = computed(() => {
    const map = this.progressMap();
    const r = this.repo.value();
    const knownRefs = new Set(r?.refs.map((ref) => ref.ref) ?? []);
    return Object.values(map).filter(
      (p) => !knownRefs.has(p.ref) && p.stage !== "ready" && p.stage !== "error",
    );
  });

  repo = httpResource<Repo>(() => {
    const name = this.routeName();
    return name ? `/api/repos/${name}` : undefined;
  });

  gitRefs = httpResource<GitRefs>(() => {
    const name = this.routeName();
    return name ? `/api/repos/${name}/git-refs` : undefined;
  });

  constructor() {
    // Poll /api/indexing-status every 1.5s.
    // Uses a stable interval (no effect re-run on repo.value() change)
    // to avoid the subscribe/unsubscribe thrashing that caused UI flicker.
    interval(1500).pipe(
      takeUntilDestroyed(this.destroyRef),
      // Only poll when there's active work or force-polling is on
      filter(() => {
        const r = this.repo.value();
        if (!r) return false;
        const hasIndexing = r.refs.some((ref) => ACTIVE_STAGES.has(ref.stage));
        const isCloning = r.mirrorStatus === "cloning";
        return hasIndexing || isCloning || this.forcePolling();
      }),
      switchMap(() =>
        this.http.get<IndexingProgress[]>("/api/indexing-status").pipe(
          catchError(() => of([] as IndexingProgress[])),
        ),
      ),
      map((list) => {
        const r = this.repo.value();
        const byRef: Record<string, IndexingProgress> = {};
        for (const p of list) {
          if (r && p.repo === r.name) byRef[p.ref] = p;
        }
        return byRef;
      }),
      tap((byRef) => {
        const prev = this.progressMap();
        this.progressMap.set(byRef);
        const values = Object.values(byRef);

        // Once all jobs are done, stop force-polling and refresh repo data
        const allDone = values.length > 0 && values.every((p) => p.stage === "ready" || p.stage === "error");
        if (allDone) {
          this.forcePolling.set(false);
        }

        // Only reload repo data when there's an actual status change
        // (not on every poll tick) to avoid unnecessary re-renders.
        const prevStages = new Map(Object.entries(prev).map(([k, v]) => [k, v.stage]));
        const currStages = new Map(Object.entries(byRef).map(([k, v]) => [k, v.stage]));
        let stageChanged = prevStages.size !== currStages.size;
        if (!stageChanged) {
          for (const [ref, stage] of currStages) {
            if (prevStages.get(ref) !== stage) { stageChanged = true; break; }
          }
        }

        if (stageChanged) {
          this.repo.reload();
        }
      }),
    ).subscribe();

    // Sync the glob patterns signal with the repo's stored value on first load.
    effect(() => {
      this.initGlobPatterns();
    });
  }

  progressFor(ref: string): IndexingProgress | undefined {
    return this.progressMap()[ref];
  }

  /** Returns true if the ref's stage indicates active indexing. */
  isActiveStage(stage: string): boolean {
    return ACTIVE_STAGES.has(stage);
  }

  trackByRef(_index: number, ref: RepoRef): string {
    return ref.ref;
  }

  protected readonly globPatterns = signal<string>("");
  protected readonly globSaving = signal(false);
  protected readonly globMessage = signal("");

  /** Sync the local signal with the repo's stored glob patterns whenever repo data loads. */
  private initGlobPatterns(): void {
    const r = this.repo.value();
    if (r) {
      this.globPatterns.set(r.globPatterns?.join(",") ?? "");
    }
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  saveGlobPatterns() {
    const name = this.routeName();
    const globPatterns = this.globPatterns().length
      ? this.globPatterns().split(",").map((p) => p.trim()).filter((p) => p.length > 0)
      : [];
    this.globSaving.set(true);
    this.globMessage.set("");

    this.http.patch(`/api/repos/${name}`, { globPatterns }).subscribe({
      next: () => {
        this.globSaving.set(false);
        this.globMessage.set("Saved.");
        this.repo.reload();
      },
      error: (err) => {
        this.globSaving.set(false);
        this.globMessage.set(err.error?.error ?? "Failed to save.");
      },
    });
  }

  sync(event: Event) {
    event.preventDefault();
    this.message.set("");
    const name = this.routeName();
    const ref = this.syncRef();

    this.http.post(`/api/repos/${name}/sync`, { ref }).subscribe({
      next: () => {
        this.message.set(`Sync enqueued for ${ref}.`);
        this.messageIsError.set(false);
        this.syncRef.set("");
        this.forcePolling.set(true);
        this.repo.reload();
      },
      error: (err) => {
        this.message.set(err.error?.error ?? "Sync failed.");
        this.messageIsError.set(true);
      },
    });
  }

  deleteRef(ref: string) {
    const name = this.routeName();
    this.http.delete(`/api/repos/${name}/versions/${ref}`).subscribe({
      next: () => this.repo.reload(),
      error: (err) => {
        this.message.set(err.error?.error ?? "Delete failed.");
        this.messageIsError.set(true);
      },
    });
  }
}
