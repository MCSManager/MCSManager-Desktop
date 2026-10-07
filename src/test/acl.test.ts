import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

function handlerCommands(): string[] {
  const source = readFileSync(resolve(ROOT, "src-tauri/src/lib.rs"), "utf8");
  const block = source.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!block) {
    throw new Error("generate_handler! block not found in lib.rs");
  }
  return [...block[1].matchAll(/commands::(\w+)/g)].map((match) => match[1]);
}

function allowedCommands(): string[] {
  const source = readFileSync(resolve(ROOT, "src-tauri/permissions/app.toml"), "utf8");
  const block = source.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    throw new Error("commands.allow block not found in app.toml");
  }
  return [...block[1].matchAll(/"(\w+)"/g)].map((match) => match[1]);
}

describe("Tauri ACL", () => {
  it("allows every command registered in the invoke handler", () => {
    const missing = handlerCommands().filter((command) => !allowedCommands().includes(command));
    expect(missing).toEqual([]);
  });
});
