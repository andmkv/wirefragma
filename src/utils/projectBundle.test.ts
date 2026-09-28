import { describe, expect, it } from "vitest";
import { createBlankProject, createSampleProject } from "../model/defaults";
import { normalizeProject } from "../model/project";
import { BundleError, bundleFilename, bundleToText, createBundle, looksLikeBundle, parseBundle } from "./projectBundle";

describe(".wfproj project bundles", () => {
  const sample = createSampleProject();
  const blank = createBlankProject();

  it("round-trips every wireframe of a project", () => {
    const text = bundleToText(createBundle("My App", [{ title: "Sample", data: sample }, { title: "Blank", data: blank }]));
    expect(looksLikeBundle(text)).toBe(true);
    const bundle = parseBundle(text);
    expect(bundle.name).toBe("My App");
    expect(bundle.wireframes.map((w) => w.title)).toEqual(["Sample", "Blank"]);
    expect(bundle.wireframes[0].data).toEqual(normalizeProject({ ...sample, title: "Sample" }));
  });

  it("keeps the stored documents as given on export (unknown fields survive in the file)", () => {
    const stored = { ...sample, futureField: { keep: {} } };
    expect(bundleToText(createBundle("P", [{ title: "A", data: stored }]))).toContain('"futureField"');
  });

  it("the wireframe title wins over the title inside the document", () => {
    const bundle = parseBundle(bundleToText(createBundle("P", [{ title: "Checkout", data: { ...sample, title: "Old" } }])));
    expect(bundle.wireframes[0].data.title).toBe("Checkout");
  });

  it("rejects other files with a clear message and never half-imports", () => {
    expect(looksLikeBundle(JSON.stringify(sample))).toBe(false);
    expect(looksLikeBundle("# UI Wireframe")).toBe(false);
    expect(() => parseBundle("{nope")).toThrow(BundleError);
    expect(() => parseBundle(JSON.stringify(sample))).toThrow(/not a Wirefragma project file/);
    expect(() => parseBundle(JSON.stringify({ format: "wirefragma-project", version: 1, wireframes: [] }))).toThrow(/no wireframes/);
    expect(() => parseBundle(JSON.stringify({ format: "wirefragma-project", version: 99, wireframes: [{}] }))).toThrow(/version 99/);
    const broken = { format: "wirefragma-project", version: 1, name: "X", wireframes: [{ title: "Good", data: sample }, { title: "Bad", data: { elements: "no" } }] };
    expect(() => parseBundle(JSON.stringify(broken))).toThrow(/“Bad”/);
  });

  it("makes readable file names", () => {
    expect(bundleFilename("My App!")).toBe("my-app.wfproj");
    expect(bundleFilename("Мой проект")).toBe("мой-проект.wfproj");
    expect(bundleFilename("   ")).toBe("project.wfproj");
  });
});
