/**
 * Raycast-inspired command palette overlay.
 *
 * Triggered by Cmd+K (Mac) / Ctrl+K (Windows/Linux) or the sidebar
 * "Search..." button. Built on Angular CDK Overlay with focus trapping,
 * arrow-key navigation, and fuzzy filtering.
 */
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal,
  computed,
  HostListener,
  inject,
  AfterViewInit,
} from "@angular/core";
import { Router } from "@angular/router";
import type { Repo } from "../types";


interface CommandItem {
  id: string;
  icon: string;
  label: string;
  group: "Repos" | "Actions";
  action: () => void;
}

@Component({
  selector: "app-command-palette",
  standalone: true,
  imports: [],
  templateUrl: "./command-palette.component.html",
  styleUrl: "./command-palette.component.css",
})
export class CommandPaletteComponent
  implements OnChanges, OnDestroy, AfterViewInit
{
  private router = inject(Router);

  /** Whether the palette is open (bound from parent). */
  @Input() open = false;

  /** Available repos (passed from parent app shell). */
  @Input() repos: Repo[] = [];

  /** Emits when the palette should close. */
  @Output() closed = new EventEmitter<void>();

  @ViewChild("searchInput") searchInput!: ElementRef<HTMLInputElement>;

  /** Current filter query. */
  query = signal("");

  /** Index of the currently highlighted item (arrow keys). */
  selectedIndex = signal(0);

  /** Debounce timer for filter input. */
  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  /** All available commands — rebuilt when repos change. */
  allItems = signal<CommandItem[]>([]);

  /** Filtered items based on query. */
  filteredItems = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.allItems();
    return this.allItems().filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  });

  /** Grouped items for rendering. */
  groupedItems = computed(() => {
    const items = this.filteredItems();
    const groups: { name: string; items: CommandItem[] }[] = [];

    const repoItems = items.filter((i) => i.group === "Repos");
    const actionItems = items.filter((i) => i.group === "Actions");

    if (repoItems.length > 0) groups.push({ name: "Repos", items: repoItems });
    if (actionItems.length > 0)
      groups.push({ name: "Actions", items: actionItems });

    return groups;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["repos"]) {
      this.rebuildItems();
    }
    if (changes["open"] && this.open) {
      this.query.set("");
      this.selectedIndex.set(0);
      // Focus input on next tick after view renders
      setTimeout(() => this.focusInput(), 0);
    }
  }

  ngAfterViewInit(): void {
    if (this.open) {
      this.focusInput();
    }
  }

  ngOnDestroy(): void {
    if (this.filterTimer) clearTimeout(this.filterTimer);
  }

  /** Rebuild all command items from current repos. */
  private rebuildItems(): void {
    const items: CommandItem[] = [];

    // Repo navigation commands
    this.repos.forEach((repo) => {
      items.push({
        id: `repo-${repo.name}`,
        icon: "folder",
        label: repo.name,
        group: "Repos",
        action: () => {
          this.router.navigate(["/", repo.name]);
          this.close();
        },
      });
    });

    // Static actions
    items.push({
      id: "action-search",
      icon: "search",
      label: "Search code",
      group: "Actions",
      action: () => {
        this.router.navigate(["/search"]);
        this.close();
      },
    });

    // Per-repo actions (browse files, view symbols, build context)
    this.repos.forEach((repo) => {
      const defaultRef = repo.refs[0]?.ref;
      if (defaultRef) {
        items.push({
          id: `browse-${repo.name}`,
          icon: "description",
          label: `Browse files \u2014 ${repo.name}`,
          group: "Actions",
          action: () => {
            this.router.navigate(["/", repo.name, defaultRef, "browse"]);
            this.close();
          },
        });
        items.push({
          id: `symbols-${repo.name}`,
          icon: "code",
          label: `View symbols \u2014 ${repo.name}`,
          group: "Actions",
          action: () => {
            this.router.navigate(["/", repo.name, defaultRef, "symbols"]);
            this.close();
          },
        });
      }
      items.push({
        id: `context-${repo.name}`,
        icon: "auto_awesome",
        label: `Build context \u2014 ${repo.name}`,
        group: "Actions",
        action: () => {
          this.router.navigate(["/", repo.name, "context"]);
          this.close();
        },
      });
    });

    this.allItems.set(items);
  }

  /** Handle filter input with 100ms debounce. */
  onFilterInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.filterTimer) clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.query.set(value);
      this.selectedIndex.set(0);
    }, 100);
  }

  /** Handle keyboard navigation within the palette. */
  @HostListener("keydown", ["$event"])
  onKeydown(event: KeyboardEvent): void {
    const items = this.filteredItems();
    const count = items.length;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.selectedIndex.update((i) => (i + 1) % Math.max(count, 1));
        this.scrollSelectedIntoView();
        break;
      case "ArrowUp":
        event.preventDefault();
        this.selectedIndex.update((i) =>
          i <= 0 ? Math.max(count - 1, 0) : i - 1,
        );
        this.scrollSelectedIntoView();
        break;
      case "Enter":
        event.preventDefault();
        if (count > 0) {
          const idx = this.selectedIndex();
          items[Math.min(idx, count - 1)]!.action();
        }
        break;
      case "Escape":
        event.preventDefault();
        this.close();
        break;
    }
  }

  /** Select an item by click. */
  selectItem(item: CommandItem): void {
    item.action();
  }

  /** Close the palette and emit event. */
  close(): void {
    this.closed.emit();
  }

  /** Close on backdrop click. */
  onScrimClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains("palette-scrim")) {
      this.close();
    }
  }

  /** Compute a flat index for a grouped item. */
  flatIndex(groupIndex: number, itemIndex: number): number {
    const groups = this.groupedItems();
    let flat = 0;
    for (let g = 0; g < groupIndex; g++) {
      flat += groups[g]!.items.length;
    }
    return flat + itemIndex;
  }

  private focusInput(): void {
    this.searchInput?.nativeElement?.focus();
  }

  private scrollSelectedIntoView(): void {
    setTimeout(() => {
      const el = document.querySelector(".palette-item.selected");
      el?.scrollIntoView({ block: "nearest" });
    }, 0);
  }
}
