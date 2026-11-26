import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import * as crypto from "node:crypto";
import ts from "typescript";

/** Executes the real TS module with explicit ports; unknown imports fail closed before any network or credentials. */
export function serverModuleLoader(stubs: Record<string, unknown>) {
  const root = process.cwd();
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(file: string): Record<string, unknown> {
    const absolute = resolve(root, file);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error("Test module outside repository");
    const cached = cache.get(absolute);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: absolute,
    }).outputText;
    const requirePort = (name: string): unknown => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === "server-only") return {};
      if (name === "node:crypto") return crypto;
      const target = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : name.startsWith(".") ? resolve(dirname(absolute), name) : null;
      if (!target) throw new Error(`Unmocked test import: ${name}`);
      return load(`${target}.ts`);
    };
    new Function("require", "exports", "module", compiled)(requirePort, module.exports, module);
    return module.exports;
  }
  return load;
}
