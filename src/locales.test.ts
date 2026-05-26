import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  flatten,
  setByPath,
  missingKeys,
  detectLayout,
  listTranslationUnits,
  type JsonObject,
} from "./locales.js";

describe("flatten", () => {
  it("flattens nested string leaves into dot notation", () => {
    const input: JsonObject = {
      app: { title: "Hello", nav: { home: "Home" } },
      count: 3,
    };
    expect(flatten(input)).toEqual({
      "app.title": "Hello",
      "app.nav.home": "Home",
    });
  });
});

describe("setByPath", () => {
  it("creates intermediate objects", () => {
    const target: JsonObject = {};
    setByPath(target, "app.nav.home", "Accueil");
    expect(target).toEqual({ app: { nav: { home: "Accueil" } } });
  });
});

describe("missingKeys", () => {
  it("returns keys missing or empty in target", () => {
    const source = { "a.b": "x", c: "y", d: "z" };
    const target = { "a.b": "déjà", c: "" };
    expect(missingKeys(source, target)).toEqual({ c: "y", d: "z" });
  });
});

describe("layout discovery", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "loc-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects and lists units for the flat layout", () => {
    fs.writeFileSync(path.join(dir, "en.json"), "{}");
    fs.writeFileSync(path.join(dir, "fr.json"), "{}");
    fs.writeFileSync(path.join(dir, "de.json"), "{}");

    expect(detectLayout(dir, "en")).toBe("flat");
    const units = listTranslationUnits(dir, "en");
    expect(units.map((u) => u.locale).sort()).toEqual(["de", "fr"]);
    expect(units.every((u) => u.namespace === null)).toBe(true);
  });

  it("detects and lists units for the nested namespace layout", () => {
    fs.mkdirSync(path.join(dir, "en"));
    fs.mkdirSync(path.join(dir, "fr"));
    fs.writeFileSync(path.join(dir, "en", "common.json"), "{}");
    fs.writeFileSync(path.join(dir, "en", "auth.json"), "{}");

    expect(detectLayout(dir, "en")).toBe("nested");
    const units = listTranslationUnits(dir, "en");
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.namespace).sort()).toEqual(["auth", "common"]);
    expect(units.every((u) => u.locale === "fr")).toBe(true);
  });

  it("returns 'none' when no source locale exists", () => {
    expect(detectLayout(dir, "en")).toBe("none");
    expect(listTranslationUnits(dir, "en")).toEqual([]);
  });
});
