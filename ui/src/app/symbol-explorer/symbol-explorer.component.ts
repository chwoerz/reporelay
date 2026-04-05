import { Component, inject, signal, computed } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import type { FindResult, SymbolLookup } from "../types";
import { HighlightPipe } from "../shared/highlight.pipe";
import { langFromPath } from "../shared/lang-from-path";

@Component({
  selector: "app-symbol-explorer",
  imports: [RouterLink, HighlightPipe],
  templateUrl: "./symbol-explorer.component.html",
  styleUrl: "./symbol-explorer.component.css",
})
export class SymbolExplorerComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private params = toSignal(this.route.paramMap.pipe(
    map((p) => ({ name: p.get("name")!, ref: p.get("ref")! })),
  ), { initialValue: { name: "", ref: "" } });

  repoName = computed(() => this.params().name);
  refName = computed(() => this.params().ref);

  pattern = signal("");
  kind = signal<"file" | "symbol">("symbol");
  loading = signal(false);
  searched = signal(false);
  error = signal("");
  findResults = signal<FindResult[]>([]);

  selectedSymbolName = signal("");
  symbolDetail = signal<SymbolLookup | null>(null);

  asValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  find(event: Event) {
    event.preventDefault();
    const p = this.pattern();
    if (!p) return;

    this.loading.set(true);
    this.error.set("");
    this.searched.set(true);
    this.symbolDetail.set(null);

    const { name, ref } = this.params();
    const url = `/api/repos/${name}/refs/${ref}/find?pattern=${encodeURIComponent(p)}&kind=${this.kind()}`;

    this.http.get<FindResult[]>(url).subscribe({
      next: (data) => {
        this.findResults.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error ?? "Search failed.");
        this.findResults.set([]);
        this.loading.set(false);
      },
    });
  }

  lookupSymbol(name: string) {
    this.selectedSymbolName.set(name);
    const { name: repoName, ref } = this.params();
    const url = `/api/repos/${repoName}/refs/${ref}/symbols/${encodeURIComponent(name)}?includeImports=true`;

    this.http.get<SymbolLookup>(url).subscribe({
      next: (data) => this.symbolDetail.set(data),
      error: (err) => this.error.set(err.error?.error ?? "Failed to load symbol."),
    });
  }

  navigateToFile(path: string) {
    this.router.navigate(["/", this.repoName(), this.refName(), "browse"], {
      queryParams: { path },
    });
  }

  langFor(filePath: string): string {
    return langFromPath(filePath) ?? "";
  }
}
