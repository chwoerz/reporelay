import {
  Component,
  computed,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import type { GitRefs } from "../../types";

@Component({
  selector: "app-ref-picker",
  imports: [],
  templateUrl: "./ref-picker.component.html",
  styleUrl: "./ref-picker.component.css",
})
export class RefPickerComponent {
  /** Available git refs (branches + tags). */
  gitRefs = input.required<GitRefs>();

  /** Placeholder text for the input. */
  placeholder = input<string>("Search branch or tag…");

  /** Emits the selected ref string. */
  refSelected = output<string>();

  search = signal("");
  dropdownOpen = signal(false);
  highlightIndex = signal(-1);

  /** Tracks the last valid selection so we can revert on blur. */
  private selectedRef = signal("");

  private wrapper = viewChild<ElementRef<HTMLElement>>("wrapper");

  filteredBranches = computed(() => {
    const q = this.search().toLowerCase();
    return this.gitRefs().branches.filter((b) => b.toLowerCase().includes(q));
  });

  filteredTags = computed(() => {
    const q = this.search().toLowerCase();
    return this.gitRefs().tags.filter((t) => t.toLowerCase().includes(q));
  });

  allFiltered = computed(() => [
    ...this.filteredBranches().map((b) => ({ type: "branch" as const, value: b })),
    ...this.filteredTags().map((t) => ({ type: "tag" as const, value: t })),
  ]);

  onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
    this.dropdownOpen.set(true);
    this.highlightIndex.set(-1);
  }

  onFocus() {
    this.dropdownOpen.set(true);
  }

  onBlur() {
    // Delay close so click on option can register
    setTimeout(() => {
      this.dropdownOpen.set(false);
      // Revert to last valid selection if typed text isn't a known ref
      const typed = this.search();
      const allRefs = [...this.gitRefs().branches, ...this.gitRefs().tags];
      if (typed && !allRefs.includes(typed)) {
        this.search.set(this.selectedRef());
      }
    }, 200);
  }

  selectOption(value: string) {
    this.search.set(value);
    this.selectedRef.set(value);
    this.dropdownOpen.set(false);
    this.refSelected.emit(value);
  }

  clear() {
    this.search.set("");
    this.selectedRef.set("");
    this.refSelected.emit("");
  }

  onKeydown(event: KeyboardEvent) {
    const items = this.allFiltered();
    const count = items.length;
    if (!count) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.highlightIndex.update((i) => (i + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.highlightIndex.update((i) => (i <= 0 ? count - 1 : i - 1));
        break;
      case "Enter":
        event.preventDefault();
        if (this.highlightIndex() >= 0 && this.highlightIndex() < count) {
          this.selectOption(items[this.highlightIndex()]!.value);
        }
        break;
      case "Escape":
        this.dropdownOpen.set(false);
        break;
    }
  }

  /** Close dropdown when clicking outside. */
  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent) {
    const el = this.wrapper()?.nativeElement;
    if (el && !el.contains(event.target as Node)) {
      this.dropdownOpen.set(false);
    }
  }
}
