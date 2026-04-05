import { Component, inject, signal, computed, effect, viewChild, ElementRef } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import type { FileContent } from "../types";
import { HighlightPipe } from "../shared/highlight.pipe";
import { langFromPath } from "../shared/lang-from-path";

@Component({
  selector: "app-file-browser",
  imports: [RouterLink],
  templateUrl: "./file-browser.component.html",
  styleUrl: "./file-browser.component.css",
})
export class FileBrowserComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  private params = toSignal(this.route.paramMap.pipe(
    map((p) => ({ name: p.get("name")!, ref: p.get("ref")! })),
  ), { initialValue: { name: "", ref: "" } });

  private queryParams = toSignal(this.route.queryParamMap.pipe(
    map((p) => p.get("path") ?? ""),
  ), { initialValue: "" });

  repoName = computed(() => this.params().name);
  refName = computed(() => this.params().ref);
  filter = signal("");

  // Tree state
  allPaths = signal<string[]>([]);
  treeLoading = signal(false);

  // File state
  selectedPath = signal("");
  fileData = signal<FileContent | null>(null);
  fileLoading = signal(false);
  fileError = signal("");

  /** Template ref to the code viewer element. */
  private codeView = viewChild<ElementRef<HTMLElement>>("codeView");

  filteredPaths = computed(() => {
    const f = this.filter().toLowerCase();
    const paths = this.allPaths();
    return f ? paths.filter((p) => p.toLowerCase().includes(f)) : paths;
  });

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
    // Load tree whenever repo/ref changes
    effect(() => {
      const { name, ref } = this.params();
      if (!name || !ref) return;
      this.loadTree(name, ref);
    });

    // Auto-select file from query param
    effect(() => {
      const path = this.queryParams();
      if (path) {
        this.selectFile(path);
      }
    });
  }

  asValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  private loadTree(name: string, ref: string) {
    this.treeLoading.set(true);
    this.http.get<string[]>(`/api/repos/${name}/refs/${ref}/tree`).subscribe({
      next: (paths) => {
        this.allPaths.set(paths);
        this.treeLoading.set(false);
      },
      error: () => {
        this.allPaths.set([]);
        this.treeLoading.set(false);
      },
    });
  }

  selectFile(path: string) {
    if (this.selectedPath() === path) return;
    this.selectedPath.set(path);
    this.fileLoading.set(true);
    this.fileError.set("");
    this.fileData.set(null);

    const name = this.repoName();
    const ref = this.refName();

    this.http.get<FileContent>(
      `/api/repos/${name}/refs/${ref}/file?path=${encodeURIComponent(path)}&includeSymbols=true`,
    ).subscribe({
      next: (data) => {
        this.fileData.set(data);
        this.fileLoading.set(false);
      },
      error: (err) => {
        this.fileError.set(err.error?.error ?? "Failed to load file.");
        this.fileLoading.set(false);
      },
    });
  }

  scrollToLine(line: number) {
    const el = this.codeView()?.nativeElement;
    if (el) {
      const lineHeight = 20; // approximate
      el.scrollTop = (line - 1) * lineHeight;
    }
  }
}
