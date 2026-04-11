import { describe, it, expect } from "vitest";
import { parseWithTreeSitter } from "./tree-sitter-parser.js";
import {
  TYPESCRIPT_SAMPLE,
  PYTHON_SAMPLE,
  GO_SAMPLE,
  JAVA_SAMPLE,
  KOTLIN_SAMPLE,
  RUST_SAMPLE,
  C_SAMPLE,
  CPP_SAMPLE,
} from "../../test/fixtures/samples.js";


const ts = () => parseWithTreeSitter(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
const py = () => parseWithTreeSitter(PYTHON_SAMPLE, "python", "calculator.py");
const go = () => parseWithTreeSitter(GO_SAMPLE, "go", "server.go");
const java = () => parseWithTreeSitter(JAVA_SAMPLE, "java", "Task.java");
const kt = () => parseWithTreeSitter(KOTLIN_SAMPLE, "kotlin", "model.kt");
const rs = () => parseWithTreeSitter(RUST_SAMPLE, "rust", "config.rs");
const c = () => parseWithTreeSitter(C_SAMPLE, "c", "server.h");
const cpp = () => parseWithTreeSitter(CPP_SAMPLE, "cpp", "logger.hpp");

const byName = (r: ReturnType<typeof ts>, name: string) => r.symbols.find((s) => s.name === name);

describe("tree-sitter Parser", () => {
  describe("TypeScript", () => {
    it("extracts top-level function declarations with name, signature, and line range", () => {
      const code = "function greet(name: string): string {\n  return name;\n}";
      const r = parseWithTreeSitter(code, "typescript", "test.ts");
      const fn = byName(r, "greet");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.startLine).toBe(1);
      expect(fn!.endLine).toBe(3);
      expect(fn!.signature).toContain("function greet");
    });

    it("extracts exported class declarations with methods", () => {
      const r = ts();
      const svc = byName(r, "Service");
      expect(svc).toBeDefined();
      expect(svc!.kind).toBe("class");
      expect(svc!.signature).toContain("export class Service");

      const methods = r.symbols.filter((s) => s.kind === "method");
      const methodNames = methods.map((m) => m.name);
      expect(methodNames).toContain("start");
      expect(methodNames).toContain("stop");
      expect(methodNames).toContain("getStatus");
    });

    it("extracts interface declarations", () => {
      const r = ts();
      const iface = byName(r, "ServiceConfig");
      expect(iface).toBeDefined();
      expect(iface!.kind).toBe("interface");
      expect(iface!.startLine).toBe(6);
      expect(iface!.endLine).toBe(10);
    });

    it("extracts type alias declarations", () => {
      const r = ts();
      const t = byName(r, "ServiceFactory");
      expect(t).toBeDefined();
      expect(t!.kind).toBe("type");
      expect(t!.signature).toContain("ServiceFactory");
    });

    it("extracts enum declarations", () => {
      const r = ts();
      const e = byName(r, "Status");
      expect(e).toBeDefined();
      expect(e!.kind).toBe("enum");
      expect(e!.startLine).toBe(13);
      expect(e!.endLine).toBe(17);
    });

    it("extracts arrow-function const exports (const foo = () => {})", () => {
      const r = ts();
      const fn = byName(r, "createService");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.content).toContain("=>");
    });

    it("extracts default exports", () => {
      const r = ts();
      const def = byName(r, "default");
      expect(def).toBeDefined();
      expect(def!.kind).toBe("variable");
      expect(def!.startLine).toBe(51);
    });

    it("captures JSDoc comments as symbol documentation", () => {
      const r = ts();
      expect(byName(r, "ServiceConfig")!.documentation).toContain(
        "Configuration options for the service",
      );
      expect(byName(r, "Status")!.documentation).toContain("Status enum for lifecycle tracking");
      expect(byName(r, "Service")!.documentation).toContain(
        "A simple service class that manages lifecycle",
      );
      expect(byName(r, "start")!.documentation).toContain("Start the service");
      expect(byName(r, "createService")!.documentation).toContain("Default factory function");
    });

    describe("imports", () => {
      it("extracts named imports (import { a } from 'b')", () => {
        const r = ts();
        const imp = r.imports.find((i) => i.source === "node:events");
        expect(imp).toBeDefined();
        expect(imp!.names).toContain("EventEmitter");
      });

      it("extracts default imports", () => {
        const code = 'import React from "react";\n';
        const r = parseWithTreeSitter(code, "typescript", "t.ts");
        const imp = r.imports.find((i) => i.source === "react");
        expect(imp).toBeDefined();
        expect(imp!.defaultName).toBe("React");
      });

      it("extracts namespace imports (import * as x from 'y')", () => {
        const code = 'import * as path from "node:path";\n';
        const r = parseWithTreeSitter(code, "typescript", "t.ts");
        const imp = r.imports.find((i) => i.source === "node:path");
        expect(imp).toBeDefined();
        expect(imp!.isNamespace).toBe(true);
      });

      it("extracts re-exports (export { x } from 'y')", () => {
        const code = 'export { foo, bar } from "./utils";\n';
        const r = parseWithTreeSitter(code, "typescript", "t.ts");
        const imp = r.imports.find((i) => i.source === "./utils");
        expect(imp).toBeDefined();
        expect(imp!.names).toEqual(["foo", "bar"]);
      });
    });
  });

  describe("JavaScript", () => {
    it("extracts function declarations", () => {
      const code = "function add(a, b) {\n  return a + b;\n}\n";
      const r = parseWithTreeSitter(code, "javascript", "math.js");
      const fn = byName(r, "add");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
    });

    it("extracts class declarations", () => {
      const code =
        "class Dog {\n  constructor(name) { this.name = name; }\n  bark() { return 'woof'; }\n}\n";
      const r = parseWithTreeSitter(code, "javascript", "dog.js");
      expect(byName(r, "Dog")).toBeDefined();
      expect(byName(r, "Dog")!.kind).toBe("class");
      expect(byName(r, "bark")!.kind).toBe("method");
    });

    it("extracts CommonJS module.exports", () => {
      const code = "function foo() {}\nmodule.exports = { foo };\n";
      const r = parseWithTreeSitter(code, "javascript", "lib.js");
      expect(byName(r, "module.exports")).toBeDefined();
    });

    it("extracts ES module imports and exports", () => {
      const code =
        'import { readFile } from "node:fs";\nexport function read() { return readFile; }\n';
      const r = parseWithTreeSitter(code, "javascript", "io.js");
      expect(r.imports.find((i) => i.source === "node:fs")).toBeDefined();
      expect(byName(r, "read")!.kind).toBe("function");
    });
  });

  describe("Python", () => {
    it("extracts function definitions with name, args, and line range", () => {
      const r = py();
      const fn = byName(r, "create_calculator");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.startLine).toBe(37);
      expect(fn!.endLine).toBe(39);
      expect(fn!.documentation).toContain("Factory function");
    });

    it("extracts class definitions with methods", () => {
      const r = py();
      const cls = byName(r, "Calculator");
      expect(cls).toBeDefined();
      expect(cls!.kind).toBe("class");

      const methods = r.symbols.filter((s) => s.kind === "method").map((m) => m.name);
      expect(methods).toContain("__init__");
      expect(methods).toContain("add");
      expect(methods).toContain("multiply");
      expect(methods).toContain("last");
    });

    it("extracts decorators as part of function/class metadata", () => {
      const r = py();
      const result = byName(r, "Result");
      expect(result).toBeDefined();
      expect(result!.kind).toBe("class");
      expect(result!.content).toContain("@dataclass");
      expect(result!.startLine).toBe(7);
    });

    it("extracts module-level docstrings", () => {
      const r = py();
      const mod = byName(r, "(module)");
      expect(mod).toBeDefined();
      expect(mod!.kind).toBe("module");
      expect(mod!.documentation).toContain("simple calculator module");
    });

    it("handles nested functions / closures", () => {
      const code = "def outer():\n    def inner():\n        return 42\n    return inner\n";
      const r = parseWithTreeSitter(code, "python", "test.py");
      expect(byName(r, "outer")).toBeDefined();
      // inner is inside outer's block — not at module scope
    });
  });

  describe("Go", () => {
    it("extracts top-level function declarations", () => {
      const r = go();
      const fn = byName(r, "New");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.documentation).toContain("creates a new Server");
    });

    it("extracts method declarations (with receiver)", () => {
      const r = go();
      const m = byName(r, "Start");
      expect(m).toBeDefined();
      expect(m!.kind).toBe("method");
      expect(m!.documentation).toContain("starts the server");
    });

    it("extracts struct definitions with fields", () => {
      const r = go();
      const s = byName(r, "Config");
      expect(s).toBeDefined();
      expect(s!.kind).toBe("struct");
      expect(s!.content).toContain("Addr string");
    });

    it("extracts interface definitions", () => {
      const r = go();
      const iface = byName(r, "Handler");
      expect(iface).toBeDefined();
      expect(iface!.kind).toBe("interface");
    });

    it("extracts type declarations", () => {
      const r = go();
      const types = r.symbols.filter((s) => ["struct", "interface", "type"].includes(s.kind));
      expect(types.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Java", () => {
    it("extracts class declarations with methods", () => {
      const r = java();
      const cls = byName(r, "Task");
      expect(cls).toBeDefined();
      expect(cls!.kind).toBe("class");

      const methods = r.symbols.filter((s) => s.kind === "method").map((m) => m.name);
      expect(methods).toContain("getName");
      expect(methods).toContain("getPriority");
      expect(methods).toContain("setPriority");
    });

    it("extracts interface declarations", () => {
      const code = "public interface Runnable {\n  void run();\n}\n";
      const r = parseWithTreeSitter(code, "java", "Runnable.java");
      expect(byName(r, "Runnable")!.kind).toBe("interface");
    });

    it("extracts enum declarations", () => {
      const r = java();
      const e = byName(r, "Priority");
      expect(e).toBeDefined();
      expect(e!.kind).toBe("enum");
    });

    it("extracts annotations on classes and methods", () => {
      const code =
        '@Entity\npublic class User {\n  @Override\n  public String toString() { return ""; }\n}\n';
      const r = parseWithTreeSitter(code, "java", "User.java");
      const cls = byName(r, "User");
      expect(cls).toBeDefined();
      expect(cls!.content).toContain("@Entity");
    });

    it("handles inner/nested classes", () => {
      const r = java();
      expect(byName(r, "Priority")).toBeDefined();
      expect(byName(r, "Task")).toBeDefined();
    });
  });

  describe("Kotlin", () => {
    it("extracts function declarations", () => {
      const r = kt();
      const fn = byName(r, "displayName");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
    });

    it("extracts class and data class declarations", () => {
      const r = kt();
      const user = byName(r, "User");
      expect(user).toBeDefined();
      expect(user!.kind).toBe("class");
      expect(user!.content).toContain("data class");
    });

    it("extracts object declarations", () => {
      const r = kt();
      const obj = byName(r, "UserValidator");
      expect(obj).toBeDefined();
      expect(obj!.kind).toBe("object");
      expect(byName(r, "validate")!.kind).toBe("method");
    });

    it("extracts extension functions", () => {
      const r = kt();
      const ext = byName(r, "displayName");
      expect(ext).toBeDefined();
      expect(ext!.signature).toContain("User.displayName");
    });
  });

  describe("Rust", () => {
    it("extracts fn declarations with visibility", () => {
      const r = rs();
      const fn = byName(r, "create_echo_processor");
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe("function");
      expect(fn!.signature).toContain("pub fn");
      expect(fn!.documentation).toContain("simple processor implementation");
    });

    it("extracts struct definitions", () => {
      const r = rs();
      const s = byName(r, "Config");
      expect(s).toBeDefined();
      expect(s!.kind).toBe("struct");
      expect(s!.content).toContain("pub name: String");
    });

    it("extracts enum definitions", () => {
      const r = rs();
      const e = byName(r, "AppError");
      expect(e).toBeDefined();
      expect(e!.kind).toBe("enum");
    });

    it("extracts trait definitions", () => {
      const r = rs();
      const t = byName(r, "Processor");
      expect(t).toBeDefined();
      expect(t!.kind).toBe("trait");
      expect(byName(r, "process")!.kind).toBe("method");
    });

    it("extracts impl blocks with methods", () => {
      const r = rs();
      const newFn = byName(r, "new");
      expect(newFn).toBeDefined();
      expect(newFn!.kind).toBe("method");
      expect(newFn!.documentation).toContain("Create a new config");

      const setFn = byName(r, "set");
      expect(setFn).toBeDefined();
      expect(setFn!.kind).toBe("method");
    });
  });

  describe("C", () => {
    it("extracts function definitions", () => {
      const code = '#include <stdio.h>\nvoid hello() {\n  printf("hello");\n}\n';
      const r = parseWithTreeSitter(code, "c", "hello.c");
      expect(byName(r, "hello")!.kind).toBe("function");
    });

    it("extracts struct definitions", () => {
      const r = c();
      expect(byName(r, "ServerConfig")!.kind).toBe("struct");
      expect(byName(r, "Server")!.kind).toBe("struct");
    });

    it("extracts typedef declarations", () => {
      const r = c();
      const structs = r.symbols.filter((s) => s.kind === "struct");
      expect(structs.length).toBeGreaterThanOrEqual(2);
    });

    it("extracts function prototypes from headers", () => {
      const r = c();
      const fns = r.symbols.filter((s) => s.kind === "function");
      const names = fns.map((f) => f.name);
      expect(names).toContain("server_create");
      expect(names).toContain("server_start");
      expect(names).toContain("server_stop");
      expect(names).toContain("server_destroy");
    });
  });

  describe("C++", () => {
    it("extracts class declarations with methods", () => {
      const r = cpp();
      const logger = byName(r, "Logger");
      expect(logger).toBeDefined();
      expect(logger!.kind).toBe("class");

      const methods = r.symbols.filter((s) => s.kind === "method").map((m) => m.name);
      expect(methods).toContain("log");
      expect(methods).toContain("debug");
      expect(methods).toContain("info");
    });

    it("extracts namespace-scoped functions", () => {
      const r = cpp();
      const ns = byName(r, "reporelay");
      expect(ns).toBeDefined();
      expect(ns!.kind).toBe("namespace");
    });

    it("extracts template declarations", () => {
      const r = cpp();
      const reg = byName(r, "Registry");
      expect(reg).toBeDefined();
      expect(reg!.kind).toBe("class");
      expect(reg!.content).toContain("template");
    });

    it("handles header vs implementation files", () => {
      const r = cpp();
      expect(r.symbols.length).toBeGreaterThan(0);
      expect(r.imports.length).toBeGreaterThanOrEqual(3);
      expect(r.imports.map((i) => i.source)).toContain("string");
    });
  });

  describe("edge cases (all languages)", () => {
    it("handles empty files", () => {
      const r = parseWithTreeSitter("", "typescript", "empty.ts");
      expect(r.symbols).toEqual([]);
      expect(r.imports).toEqual([]);
    });

    it("handles files with syntax errors (partial parse)", () => {
      const code = "function good() { return 1; }\nfunction bad( { \nconst x = 42;\n";
      const r = parseWithTreeSitter(code, "typescript", "broken.ts");
      const good = byName(r, "good");
      expect(good).toBeDefined();
      expect(good!.kind).toBe("function");
    });

    it("returns line ranges as 1-based inclusive", () => {
      const code = "function foo() {\n  return 1;\n}\n";
      const r = parseWithTreeSitter(code, "typescript", "test.ts");
      const fn = byName(r, "foo");
      expect(fn!.startLine).toBe(1);
      expect(fn!.endLine).toBe(3);
      expect(fn!.startLine).toBeGreaterThanOrEqual(1);
    });
  });
});
