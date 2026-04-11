import { Component, effect, inject, signal, computed, viewChild, ElementRef } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import type { FindResult, SymbolLookup, FileContent } from "../types";
import { HighlightPipe } from "../shared/highlight.pipe";
import { langFromPath } from "../shared/lang-from-path";

@Component({
  selector: "app-symbol-explorer",
  imports: [RouterLink],
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

  // File viewer state (right panel)
  selectedPath = signal("");
  scrollToTarget = signal(0);
  fileData = signal<FileContent | null>(null);
  fileLoading = signal(false);
  fileError = signal("");

  /** Template ref to the code viewer element. */
  private codeView = viewChild<ElementRef<HTMLElement>>("codeView");

  numberedContent = computed(() => {
    const data = this.fileData();
    if (!data) return "";
    return data.content
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
      .join("\n");
  });

  highlightedContent = computed(() => {
    const data = this.fileData();
    if (!data) return "";
    const lang = langFromPath(data.path);
    const numbered = this.numberedContent();
    const pipe = new HighlightPipe();
    return pipe.transform(numbered, lang);
  });

  constructor() {
    effect(() => {
      const kind = this.kind();
      /* Skip the initial run — only re-search on user-driven changes. */
      if (kind === "symbol" && !this.searched()) return;
      this.executeSearch();
    });
  }

  asValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  find(event: Event) {
    event.preventDefault();
    this.executeSearch();
  }

  private executeSearch() {
    const p = this.pattern();
    if (!p) {
      this.findResults.set([]);
      this.searched.set(false);
      this.symbolDetail.set(null);
      this.error.set("");
      return;
    }

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

  lookupSymbol(result: FindResult) {
    const name = result.name!;
    this.selectedSymbolName.set(name);
    const { name: repoName, ref } = this.params();
    const url = `/api/repos/${repoName}/refs/${ref}/symbols/${encodeURIComponent(name)}?includeImports=true`;

    this.http.get<SymbolLookup>(url).subscribe({
      next: (data) => this.symbolDetail.set(data),
      error: (err) => this.error.set(err.error?.error ?? "Failed to load symbol."),
    });

    // Open file in right panel and scroll to the symbol's line
    if (result.filePath) {
      this.openFile(result.filePath, result.startLine ?? 1);
    }
  }

  openFile(path: string, scrollToLine = 1) {
    this.fileLoading.set(true);
    this.fileError.set("");
    this.selectedPath.set(path);
    this.scrollToTarget.set(scrollToLine);

    if (this.fileData()?.path === path) {
      // Same file already loaded — just scroll
      this.fileLoading.set(false);
      this.scrollToLine(scrollToLine);
      return;
    }

    this.fileData.set(null);

    const { name, ref } = this.params();
    this.http.get<FileContent>(
      `/api/repos/${name}/refs/${ref}/file?path=${encodeURIComponent(path)}&includeSymbols=true`,
    ).subscribe({
      next: (data) => {
        this.fileData.set(data);
        this.fileLoading.set(false);
        // Defer scroll so the DOM has time to render
        setTimeout(() => this.scrollToLine(this.scrollToTarget()), 50);
      },
      error: (err) => {
        this.fileError.set(err.error?.error ?? "Failed to load file.");
        this.fileLoading.set(false);
      },
    });
  }

  navigateToFile(path: string) {
    this.router.navigate(["/", this.repoName(), this.refName(), "browse"], {
      queryParams: { path },
    });
  }

  scrollToLine(line: number) {
    const el = this.codeView()?.nativeElement;
    if (el) {
      const lineHeight = 20;
      el.scrollTop = (line - 1) * lineHeight;
    }
  }

  langFor(filePath: string): string {
    return langFromPath(filePath) ?? "";
  }
}
