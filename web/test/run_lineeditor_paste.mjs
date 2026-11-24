// V-003: rich paste into the line editor (clipboard HTML -> one row per line in the note markup). Fake content only.
// Run: node web/test/run_lineeditor_paste.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pasteToLines } from "../js/lineeditor-paste.js";
import { plainText, styledChars, serialize } from "../js/lineeditor-format.js";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

// a OneNote document becomes rows: no blank lines, no heading marks, lists keep "- " and two-space levels
{
  const out = pasteToLines({ html: fixture("onenote-desktop-clipboard.html"), text: "" });
  assert.ok(out && out.includes("\n"), "multi-row result");
  const rows = out.split("\n");
  assert.ok(rows.every((r) => r.trim() !== ""), "no blank rows");
  assert.ok(rows.every((r) => !/^#{1,6}\s/.test(r)), "headings are flattened");
  assert.ok(rows.some((r) => /^ *- /.test(r)), "list items stay bullets");
  assert.ok(out.includes("**정기 점검**"), "bold survives as the note markup");
  // the pasted text is stored as is; a later format op rewrites a row in the editor's canonical spelling without changing what it shows
  const look = (t) => JSON.stringify(styledChars(t).map((c) => [c.ch, c.st]));
  for (const r of rows) {
    const body = r.replace(/^ *(?:- (?:\[[ xX*!]\] )?)?/, "");
    const again = serialize(styledChars(body)).text;
    assert.equal(look(again), look(body), "same look after a rewrite: " + r);
    assert.equal(serialize(styledChars(again)).text, again, "stable from the second save on: " + r);
  }
}
// a formatted phrase pasted mid-line stays inline
{
  const out = pasteToLines({ html: "<p>EQ-A01 <b>점검</b></p>", text: "EQ-A01 점검" });
  assert.equal(out, "EQ-A01 **점검**", "a formatted phrase is pasted inline");
  assert.equal(pasteToLines({ html: "<p>EQ-A01 plain</p>", text: "EQ-A01 plain" }), null, "a plain line keeps the browser's own paste");
  const rich = pasteToLines({ html: '<p><span style="color:#d93025"><b>긴급</b></span></p>', text: "긴급" });
  assert.ok(rich === null || !rich.includes("\n"), "one phrase is one inline run");
}
// tables, code and pictures are left to the plain text paste
assert.equal(pasteToLines({ html: "<table><tr><td>a</td><td>b</td></tr></table>", text: "a\tb" }), null);
assert.equal(pasteToLines({ html: "<pre>code here</pre>", text: "code here" }), null);
assert.equal(pasteToLines({ html: "", text: "just text" }), null);
// hostile html never produces markup the editor would execute
{
  const out = pasteToLines({ html: fixture("web-hostile-clipboard.html"), text: "" });
  assert.ok(out === null || (!/<script|<img|onerror=|javascript:/i.test(out)), "no active markup: " + out);
  if (out) assert.ok(plainText(out).length > 0);
}
console.log("PASS lineeditor paste");
