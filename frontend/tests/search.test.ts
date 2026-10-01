import { expect, test } from "vitest";
import { doc, makeEditor, para, txt } from "./helpers";

test("search crosses mark boundaries and respects case toggle", () => {
  const e = makeEditor(doc(para(txt("Hel", { type: "bold" }), txt("lo hello HELLO"))));
  e.commands.setSearchTerm("hello");
  expect(e.storage.searchAndReplace.results).toEqual([{ from: 1, to: 6 }, { from: 7, to: 12 }, { from: 13, to: 18 }]);
  e.commands.setCaseSensitive(true);
  expect(e.storage.searchAndReplace.results).toEqual([{ from: 7, to: 12 }]);
  e.commands.setSearchTerm("");
  expect(e.storage.searchAndReplace.results).toEqual([]);
});

test("literal regex characters do not become patterns", () => {
  const e = makeEditor(doc(para(txt("a.b axb"))));
  e.commands.setSearchTerm("a.b");
  expect(e.storage.searchAndReplace.results).toEqual([{ from: 1, to: 4 }]);
});

test("navigation wraps and direct result index validates bounds", () => {
  const e = makeEditor(doc(para(txt("a a"))));
  e.commands.setSearchTerm("a");
  e.commands.nextSearchResult();
  expect(e.storage.searchAndReplace.resultIndex).toBe(1);
  e.commands.nextSearchResult();
  expect(e.storage.searchAndReplace.resultIndex).toBe(0);
  e.commands.previousSearchResult();
  expect(e.storage.searchAndReplace.resultIndex).toBe(1);
  e.commands.goToSearchResult(999);
  expect(e.storage.searchAndReplace.resultIndex).toBe(1);
  e.commands.resetIndex();
  expect(e.storage.searchAndReplace.resultIndex).toBe(0);
});

test.each(["x", "longer", ""])("replace all with %j preserves all match positions", replacement => {
  const e = makeEditor(doc(para(txt("cat cat cat"))));
  e.commands.setSearchTerm("cat");
  e.commands.setReplaceTerm(replacement);
  e.commands.replaceAll();
  expect(e.getText()).toBe([replacement, replacement, replacement].join(" "));
});

test("single replace and no-match replace", () => {
  const e = makeEditor(doc(para(txt("cat cat"))));
  e.commands.setSearchTerm("cat");
  e.commands.setReplaceTerm("dog");
  e.commands.replace();
  expect(e.getText()).toBe("dog cat");
  e.commands.setSearchTerm("absent");
  e.commands.replace();
  expect(e.getText()).toBe("dog cat");
});
