import { Component, signal, computed, HostListener, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { httpResource } from '@angular/common/http';
import { CommandPaletteComponent } from './command-palette/command-palette.component';
import type { Repo } from './types';

/** Active indexing stages — repos in these stages show a cyan dot. */
const INDEXING_STAGES = new Set([
  'queued', 'syncing', 'resolving', 'checking-out', 'diffing',
  'processing-files', 'embedding', 'finalizing',
]);

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommandPaletteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class App {
  private router = inject(Router);

  /** Sidebar collapsed state. */
  sidebarCollapsed = signal(false);

  /** Whether the command palette is open. */
  commandPaletteOpen = signal(false);

  /** Detect macOS for keyboard shortcut label. */
  isMac = navigator.platform.toUpperCase().includes('MAC');

  /** Repo list for sidebar shortcuts. */
  reposResource = httpResource<Repo[]>(() => '/api/repos');

  repos = computed(() => this.reposResource.value() ?? []);

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
