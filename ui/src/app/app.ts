import { Component, signal, computed, HostListener, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { httpResource } from '@angular/common/http';
import { CommandPaletteComponent } from './command-palette/command-palette.component';
import type { Repo, HealthResponse } from './types';

/** Active indexing stages — repos in these stages show a cyan dot. */
const INDEXING_STAGES = new Set([
  'queued', 'syncing', 'resolving', 'checking-out', 'diffing',
  'processing-files', 'embedding', 'finalizing',
]);

/** How often to poll /health (ms). */
const HEALTH_POLL_INTERVAL = 15_000;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommandPaletteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  private router = inject(Router);
  private http = inject(HttpClient);
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  /** Sidebar collapsed state. */
  sidebarCollapsed = signal(false);

  /** Whether the command palette is open. */
  commandPaletteOpen = signal(false);

  /** Detect macOS for keyboard shortcut label. */
  isMac = navigator.platform.toUpperCase().includes('MAC');

  /** Repo list for sidebar shortcuts. */
  reposResource = httpResource<Repo[]>(() => '/api/repos');

  repos = computed(() => this.reposResource.value() ?? []);

  /** Embedder error message — non-empty when Ollama is unreachable. */
  embedderError = signal('');

  /** Whether the banner has been manually dismissed. */
  bannerDismissed = signal(false);

  /** Show the banner when there's an embedder error and it hasn't been dismissed. */
  showBanner = computed(() => this.embedderError() !== '' && !this.bannerDismissed());

  constructor() {
    this.pollHealth();
    this.healthTimer = setInterval(() => this.pollHealth(), HEALTH_POLL_INTERVAL);
  }

  /** Poll the /health endpoint and update embedder status. */
  private pollHealth(): void {
    this.http.get<HealthResponse>('/health').subscribe({
      next: (res) => {
        const error = res.embedder?.status === 'error'
          ? (res.embedder.error ?? 'Ollama is not reachable')
          : '';
        const prev = this.embedderError();
        this.embedderError.set(error);
        // Reset dismiss when the error changes (e.g. new error or recovered)
        if (error !== prev) {
          this.bannerDismissed.set(false);
        }
      },
      error: () => {
        // Backend itself is unreachable — not the same as embedder error,
        // so don't show the embedder banner for this case.
      },
    });
  }

  dismissBanner(): void {
    this.bannerDismissed.set(true);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  /** Returns true if any ref on the repo is actively indexing. */
  isIndexing(repo: Repo): boolean {
    return repo.refs.some((r) => INDEXING_STAGES.has(r.stage));
  }

  /** Returns true if any ref has an error stage. */
  isError(repo: Repo): boolean {
    return repo.refs.some((r) => r.stage === 'error');
  }

  /** Returns true if all refs are ready. */
  isReady(repo: Repo): boolean {
    return repo.refs.length > 0 && repo.refs.every((r) => r.stage === 'ready');
  }

  openCommandPalette(): void {
    this.commandPaletteOpen.set(true);
  }

  closeCommandPalette(): void {
    this.commandPaletteOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    const mod = this.isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.key === 'k') {
      event.preventDefault();
      this.commandPaletteOpen.update((v) => !v);
    }
  }
}
