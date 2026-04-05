export { classifyLanguage, buildIgnoreFilterFromRepo, filterIgnored } from "./file-classifier.js";
export { detectLanguagesFromDir } from "./language-detector.js";

export {
  syncMirror,
  resolveCommitSha,
  checkoutWorktree,
  cleanupWorktree,
  listFiles,
  readFileFromMirror,
  listGitRefs,
  type GitRefs,
} from "./git-sync.js";
