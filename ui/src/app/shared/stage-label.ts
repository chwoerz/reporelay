import type { IndexingProgress, IndexingStage } from '../types';

/**
 * Human-friendly label for an indexing stage (with emoji prefix).
 * Used by the repo detail progress cards.
 */
export function stageLabel(stage: IndexingStage): string {
  const labels: Record<IndexingStage, string> = {
    'queued': '⏳ Queued',
    'syncing': '🔄 Syncing',
    'resolving': '🔍 Resolving',
    'checking-out': '📂 Checkout',
    'diffing': '📊 Diffing',
    'processing-files': '⚙️ Processing',
    'embedding': '🧠 Embedding',
    'finalizing': '✅ Finalizing',
    'ready': '✅ Done',
    'error': '❌ Error',
  };
  return labels[stage] ?? stage;
}

/** File processing percentage (0–100). */
export function filePercent(p: IndexingProgress): number {
  return p.filesTotal > 0 ? Math.round((p.filesProcessed / p.filesTotal) * 100) : 0;
}

/** Chunk embedding percentage (0–100). */
export function chunkPercent(p: IndexingProgress): number {
  return p.chunksTotal > 0 ? Math.round((p.chunksEmbedded / p.chunksTotal) * 100) : 0;
}

