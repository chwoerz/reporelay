import { Component, computed, input } from "@angular/core";
import type { IndexingProgress } from "../../types";
import { stageLabel, filePercent, chunkPercent } from "../stage-label";

@Component({
  selector: "app-progress-card",
  imports: [],
  templateUrl: "./progress-card.component.html",
  styleUrl: "./progress-card.component.css",
})
export class ProgressCardComponent {
  /** The indexing progress data to display. */
  progress = input.required<IndexingProgress>();

  /** Whether to show the ref name as a title (used for pending/above-table cards). */
  showRefName = input(false);

  /** Whether this is a "pending" card (adds extra styling class). */
  pending = input(false);

  readonly stageLabel = stageLabel;
  readonly filePercent = filePercent;
  readonly chunkPercent = chunkPercent;

  /** Message text without the file path suffix. */
  messageText = computed(() => {
    const msg = this.progress().message;
    const sep = msg.indexOf(" · ");
    return sep === -1 ? msg : msg.slice(0, sep);
  });

  /** Current file being processed (extracted from message after " · " separator). */
  currentFile = computed(() => {
    const msg = this.progress().message;
    const sep = msg.indexOf(" · ");
    return sep === -1 ? "" : msg.slice(sep + 3);
  });
}
