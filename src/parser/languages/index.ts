/**
 * Barrel export for all language extractors.
 */
export type { LanguageExtractor, SyntaxNode } from "./base.js";

export { TypeScriptJavaScriptExtractor } from "./typescript-javascript.js";
export { PythonExtractor } from "./python.js";
export { GoExtractor } from "./go.js";
export { JavaExtractor } from "./java.js";
export { KotlinExtractor } from "./kotlin.js";
export { RustExtractor } from "./rust.js";
export { CExtractor } from "./c.js";
export { CppExtractor } from "./cpp.js";
