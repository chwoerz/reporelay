import { Component, inject, signal, computed } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HttpClient, httpResource } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import type { ContextPackResult, GitRefs } from "../types";
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

  gitRefs = httpResource<GitRefs>(() => {
    const name = this.repoName();
    return name ? `/api/repos/${name}/git-refs` : undefined;
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
