import * as fs from "node:fs";
import * as path from "node:path";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A single source→target file pair to translate. */
export interface TranslationUnit {
  locale: string;
  namespace: string | null;
  sourcePath: string;
  targetPath: string;
}

/** Flatten a nested object into dot-notation keys. Only string leaves are translatable. */
export function flatten(obj: JsonObject, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value as JsonObject, full));
    } else if (typeof value === "string") {
      out[full] = value;
    }
  }
  return out;
}

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Set a dot-notation key on a nested object, creating intermediate objects as needed. */
export function setByPath(target: JsonObject, dotKey: string, value: string): void {
  const parts = dotKey.split(".");
  // Prevent prototype pollution: keys come from attacker-controlled source JSON.
  if (parts.some((p) => FORBIDDEN_PATH_SEGMENTS.has(p))) return;
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (node[part] === undefined || typeof node[part] !== "object" || node[part] === null) {
      node[part] = {};
    }
    node = node[part] as JsonObject;
  }
  node[parts[parts.length - 1]] = value;
}

export function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
}

export function writeJson(filePath: string, obj: JsonObject): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export type Layout = "flat" | "nested" | "none";

/**
 * Detect the locale directory layout:
 * - "flat":   {dir}/{locale}.json
 * - "nested": {dir}/{locale}/{namespace}.json
 */
export function detectLayout(dir: string, sourceLocale: string): Layout {
  if (fs.existsSync(path.join(dir, `${sourceLocale}.json`))) return "flat";
  const nested = path.join(dir, sourceLocale);
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return "nested";
  return "none";
}

/** Build the list of source→target file pairs for either layout. */
export function listTranslationUnits(dir: string, sourceLocale: string): TranslationUnit[] {
  const layout = detectLayout(dir, sourceLocale);

  if (layout === "flat") {
    const sourcePath = path.join(dir, `${sourceLocale}.json`);
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.basename(f, ".json"))
      .filter((code) => code !== sourceLocale)
      .map((locale) => ({
        locale,
        namespace: null,
        sourcePath,
        targetPath: path.join(dir, `${locale}.json`),
      }));
  }

  if (layout === "nested") {
    const sourceDir = path.join(dir, sourceLocale);
    const namespaces = fs
      .readdirSync(sourceDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.basename(f, ".json"));
    const targetLocales = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== sourceLocale)
      .map((d) => d.name);

    const units: TranslationUnit[] = [];
    for (const locale of targetLocales) {
      for (const namespace of namespaces) {
        units.push({
          locale,
          namespace,
          sourcePath: path.join(sourceDir, `${namespace}.json`),
          targetPath: path.join(dir, locale, `${namespace}.json`),
        });
      }
    }
    return units;
  }

  return [];
}

/** Keys present (as strings) in source but missing or empty in target. */
export function missingKeys(
  source: Record<string, string>,
  target: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (current === undefined || current === "") {
      out[key] = value;
    }
  }
  return out;
}
