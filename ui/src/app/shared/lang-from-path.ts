/**
 * Maps a file path (by extension) to a highlight.js language identifier.
 */

const EXT_MAP: Record<string, string> = {
  '.ts':   'typescript',
  '.tsx':  'typescript',
  '.mts':  'typescript',
  '.cts':  'typescript',
  '.js':   'javascript',
  '.jsx':  'javascript',
  '.mjs':  'javascript',
  '.cjs':  'javascript',
  '.py':   'python',
  '.pyi':  'python',
  '.go':   'go',
  '.java': 'java',
  '.kt':   'kotlin',
  '.kts':  'kotlin',
  '.rs':   'rust',
  '.c':    'c',
  '.h':    'c',
  '.cpp':  'cpp',
  '.cc':   'cpp',
  '.cxx':  'cpp',
  '.hpp':  'cpp',
  '.hxx':  'cpp',
  '.md':   'markdown',
  '.mdx':  'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml':  'yaml',
  '.sql':  'sql',
  '.sh':   'bash',
  '.bash': 'bash',
  '.zsh':  'bash',
  '.css':  'css',
  '.scss': 'scss',
  '.html': 'xml',
  '.xml':  'xml',
  '.toml': 'ini',
  '.dockerfile': 'dockerfile',
};

/** Special full-filename matches (case-insensitive). */
const NAME_MAP: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile':   'makefile',
};

/**
 * Infer a highlight.js language from a file path.
 * Returns `undefined` if the extension is not recognized.
 */
export function langFromPath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;

  // Check full filename first
  if (NAME_MAP[basename]) return NAME_MAP[basename];

  // Then extension
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx === -1) return undefined;
  const ext = basename.substring(dotIdx);
  return EXT_MAP[ext];
}

