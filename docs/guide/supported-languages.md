# Supported Languages

RepoRelay uses [tree-sitter](https://tree-sitter.github.io/) for code parsing and a custom parser for Markdown.

| Language                | Parser      | Extracted Symbols                                              |
| :---------------------- | :---------- | :------------------------------------------------------------- |
| TypeScript / JavaScript | tree-sitter | Functions, classes, interfaces, types, enums, methods, exports |
| Python                  | tree-sitter | Functions, classes, methods, decorators                        |
| Go                      | tree-sitter | Functions, structs, interfaces, methods                        |
| Java                    | tree-sitter | Classes, interfaces, methods, enums                            |
| Kotlin                  | tree-sitter | Classes, objects, functions, data classes                      |
| Rust                    | tree-sitter | Functions, structs, enums, traits, impls                       |
| C                       | tree-sitter | Functions, structs, enums, typedefs                            |
| C++                     | tree-sitter | Functions, classes, structs, namespaces                        |
| Markdown                | Custom      | Headings, code blocks, links                                   |

## How Parsing Works

Each language has a dedicated extractor in `src/parser/languages/`. The unified tree-sitter pipeline:

1. Loads the appropriate grammar for the file's language
2. Parses the file into an AST
3. Walks the AST using language-specific queries to extract symbols and imports
4. Returns structured `ParsedSymbol` and `ParsedImport` objects

Unsupported file types (`.json`, `.png`, `.lock`, etc.) are silently skipped — they don't produce ref_files entries.
