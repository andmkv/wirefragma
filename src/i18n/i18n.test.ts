import { beforeAll, describe, expect, it } from "vitest";
import { en } from "./en";
import { LOCALES, getDictionary, loadDictionary, translate, type Locale } from "./index";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** The non-English dictionaries are lazy chunks; load them all for this suite. */
beforeAll(async () => {
  await Promise.all(LOCALES.map(({ code }) => loadDictionary(code)));
});

describe("dictionaries", () => {
  for (const { code } of LOCALES) {
    it(`${code}: has every English key and no unknown keys`, () => {
      const dictionary = getDictionary(code) as Record<string, string>;
      // Empty is allowed only for sentence fragments around a link (word order differs, e.g. JA).
      const mayBeEmpty = (key: string) => key.endsWith("consentBefore") || key.endsWith("consentAfter");
      const missing = Object.keys(en).filter(
        (key) => typeof dictionary[key] !== "string" || (dictionary[key] === "" && !mayBeEmpty(key))
      );
      expect(missing).toEqual([]);
      const unknown = Object.keys(dictionary).filter((key) => {
        if (key in en) return false;
        const base = key.replace(PLURAL_SUFFIX, "");
        return !(`${base}_other` in en);
      });
      expect(unknown).toEqual([]);
    });

    it(`${code}: keeps the placeholders of every message`, () => {
      const dictionary = getDictionary(code) as Record<string, string>;
      const broken = Object.entries(dictionary).filter(([key, value]) => {
        const englishKey = key in en ? key : `${key.replace(PLURAL_SUFFIX, "")}_other`;
        const english = (en as Record<string, string>)[englishKey];
        // Plural forms may drop {count} ("one" often reads "a layer"), but never invent names.
        const allowed = new Set(placeholders(english));
        return placeholders(value).some((name) => !allowed.has(name)) ||
          (!PLURAL_SUFFIX.test(key) && placeholders(value).join() !== placeholders(english).join());
      });
      expect(broken.map(([key]) => key)).toEqual([]);
    });

    it(`${code}: covers every plural category the language uses`, () => {
      const dictionary = getDictionary(code) as Record<string, string>;
      const rules = new Intl.PluralRules(code === "zh" ? "zh-CN" : code);
      const categories = rules.resolvedOptions().pluralCategories;
      const families = Object.keys(en).filter((key) => key.endsWith("_other")).map((key) => key.slice(0, -6));
      const gaps = families.flatMap((family) =>
        categories.filter((category) => typeof dictionary[`${family}_${category}`] !== "string").map((c) => `${family}_${c}`)
      );
      expect(gaps).toEqual([]);
    });
  }
});

describe("translate", () => {
  it("fills placeholders and picks plural forms", () => {
    expect(translate("en", "layers.count", { count: 1 })).toBe("1 layer");
    expect(translate("en", "layers.count", { count: 3 })).toBe("3 layers");
    expect(translate("en", "panel.show", { panel: "Layers" })).toBe("Show Layers");
  });

  it("falls back to English for a missing key", () => {
    const locale: Locale = "de";
    const dictionary = getDictionary(locale) as Record<string, string>;
    const saved = dictionary["common.close"];
    delete dictionary["common.close"];
    expect(translate(locale, "common.close")).toBe("Close");
    dictionary["common.close"] = saved;
  });

  it("loads every dictionary exactly once and caches it", async () => {
    const first = await loadDictionary("ru");
    const second = await loadDictionary("ru");
    expect(second).toBe(first);
    expect(getDictionary("ru")).toBe(first);
  });
});
