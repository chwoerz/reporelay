import { Component, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { RouterLink } from "@angular/router";
import type { SearchResult } from "../types";
import { HighlightPipe } from "../shared/highlight.pipe";
import { langFromPath } from "../shared/lang-from-path";

@Component({
  selector: "app-search",
  imports: [RouterLink, HighlightPipe],
  templateUrl: "./search.component.html",
  styleUrl: "./search.component.css",
})
export class SearchComponent {
  private http = inject(HttpClient);

  query = signal("");
  repo = signal("");
  ref = signal("");
  loading = signal(false);
  error = signal("");
  searched = signal(false);
  results = signal<SearchResult[]>([]);

  asValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  langFor(filePath: string): string {
    return langFromPath(filePath) ?? "";
  }

  search(event: Event) {
    event.preventDefault();
    const q = this.query();
    if (!q) return;

    this.loading.set(true);
    this.error.set("");
    this.searched.set(true);

    let url = `/api/search?query=${encodeURIComponent(q)}`;
    if (this.repo()) url += `&repo=${encodeURIComponent(this.repo())}`;
    if (this.ref()) url += `&ref=${encodeURIComponent(this.ref())}`;

    this.http.get<SearchResult[]>(url).subscribe({
      next: (data) => {
        this.results.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error ?? "Search failed.");
        this.results.set([]);
        this.loading.set(false);
      },
    });
  }
}
