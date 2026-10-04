import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { containsCjk } from "./cjk";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".rs"]);
const SCAN_ROOTS = ["src", "src-tauri/src"];
const EXCLUDED_FRAGMENT = "src/i18n/locales";

function collectCodeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const normalized = fullPath.split(sep).join("/");
    if (normalized.includes(EXCLUDED_FRAGMENT)) {
      continue;
    }
    if (entry.isDirectory()) {
      collectCodeFiles(fullPath, acc);
    } else if (CODE_EXTENSIONS.has(extname(entry.name))) {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe("no Chinese in code", () => {
  it("has no CJK characters in code files outside locale files", () => {
    const offenders: string[] = SCAN_ROOTS.flatMap((scanRoot) => collectCodeFiles(scanRoot)).filter(
      (file) => containsCjk(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
