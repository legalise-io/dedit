// @vitest-environment node
import { describe, expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { createDeditExtensions } from "./createDeditExtensions";

describe("createDeditExtensions", () => {
  test("factory builds schema in Node without DOM", () => {
    const schema = getSchema(createDeditExtensions({ collaboration: true }));
    for (const n of ["paragraph", "heading", "table", "rawStylesStorage", "section"])
      expect(schema.nodes[n]).toBeDefined();
    for (const m of ["insertion", "deletion", "comment"])
      expect(schema.marks[m]).toBeDefined();
  });

  test("collaboration mode omits History", () => {
    const names = (c: boolean) => createDeditExtensions({ collaboration: c }).map((e) => e.name);
    expect(names(false)).toContain("history");
    expect(names(true)).not.toContain("history");
  });
});
