// node web/test/run_mdblocks.mjs — block segmentation keeps every byte (P3-02R). Exits 1 on failure.
import assert from "node:assert/strict";
import { joinBlocks, listTree, parseListLine, segment } from "../js/mdblocks.js";

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const kinds = (md) => segment(md).blocks.map((b) => b.kind);

const SAMPLES = {
  plain: "# 제목\n\n본문 한 줄\n",
  "no trailing newline": "# 제목\n\n본문",
  "leading blank lines": "\n\n# 제목\n\n본문\n",
  "extra blank lines": "# A\n\n\n\n본문\n\n\n",
  "no blank between blocks": "# A\n본문\n- a\n- b\n다음\n",
  "nested list": "- 상위\n  - 하위\n    - 더 하위\n  - 하위2\n- 상위2\n",
  marks: "- [ ] 할일\n- [x] 완료\n- [*] 별표\n- [!] 긴급\n  - [ ] 하위 할일\n",
  highlight: '- <mark>형광</mark> 줄\n  - [*] <mark>하위 형광</mark>\n',
  "code fence": "문장\n\n```python\n# not a heading\n\n- not a list\n```\n\n끝\n",
  "tilde fence": "~~~\nraw\n~~~\n",
  "unclosed fence": "```\nraw 1\n\nraw 2\n",
  table: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n끝\n",
  quote: "> 인용 1\n> 인용 2\n\n본문\n",
  comment: "<!-- column -->\n\n<!--\n여러 줄\n-->\n\n본문\n",
  "deep heading and rule": "#### 넷째\n\n---\n\n본문\n",
  "ordered list": "1. 하나\n2. 둘\n   - 하위\n",
  "mixed list types": "- a\n- b\n1. x\n2. y\n",
  "crlf": "# 제목\r\n\r\n- a\r\n  - b\r\n",
  "mixed line endings": "# 제목\r\n\n- a\r  - b\n",
  "whitespace only": "  \n\n",
  empty: "",
  "trailing spaces": "문장  \n둘째 줄  \n\n- a  \n",
  "tabs indent": "- a\n\t- b\n",
};

for (const [name, md] of Object.entries(SAMPLES)) {
  t(`join(segment) is the file: ${name}`, () => {
    const seg = segment(md);
    assert.equal(joinBlocks(seg), md);
    assert.equal(seg.eol, md.match(/\r\n|\r|\n/)?.[0] || "\n");
  });
}

t("kinds", () => {
  assert.deepEqual(kinds(SAMPLES["code fence"]), ["p", "code", "p"]);
  assert.deepEqual(kinds(SAMPLES.table), ["table", "p"]);
  assert.deepEqual(kinds(SAMPLES.quote), ["quote", "p"]);
  assert.deepEqual(kinds(SAMPLES.comment), ["comment", "comment", "p"]);
  assert.deepEqual(kinds(SAMPLES["deep heading and rule"]), ["deep", "hr", "p"]);
  assert.deepEqual(kinds(SAMPLES["no blank between blocks"]), ["h", "p", "list", "p"]);
  assert.deepEqual(kinds(SAMPLES["mixed list types"]), ["list", "list"]);
  assert.deepEqual(kinds("#hashtag\n"), ["p"]);
});

t("a fence keeps its blank lines and look-alike lines in one block", () => {
  const b = segment(SAMPLES["code fence"]).blocks[1];
  assert.equal(b.src, "```python\n# not a heading\n\n- not a list\n```");
});

t("gaps are kept exactly", () => {
  const seg = segment(SAMPLES["extra blank lines"]);
  assert.deepEqual(seg.blocks.map((b) => b.gap), ["\n\n\n\n", "\n\n\n"]);
  assert.equal(segment(SAMPLES["leading blank lines"]).pre, "\n\n");
  assert.equal(segment("a").blocks[0].gap, "");
});

t("list lines parse marks and depth", () => {
  assert.deepEqual(parseListLine("  - [*] 별표"), { ind: 2, type: "ul", mark: "*", text: "별표" });
  assert.deepEqual(parseListLine("- [X] 완료"), { ind: 0, type: "ul", mark: "x", text: "완료" });
  assert.deepEqual(parseListLine("- [ ]"), { ind: 0, type: "ul", mark: " ", text: "" });
  assert.deepEqual(parseListLine("- 그냥"), { ind: 0, type: "ul", mark: null, text: "그냥" });
  assert.deepEqual(parseListLine("1. 번호"), { ind: 0, type: "ol", mark: null, text: "번호" });
  assert.equal(parseListLine("**굵게**"), null);
  assert.equal(parseListLine("---"), null);
  assert.equal(parseListLine("-하이픈"), null);
});

t("list tree nests by indent", () => {
  const tree = listTree(SAMPLES["nested list"]);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].kids.length, 2);
  assert.equal(tree[0].kids[0].kids[0].text, "더 하위");
  assert.equal(tree[1].text, "상위2");
});

let bad = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS", name); } catch (e) { bad++; console.log("FAIL", name, e.message); }
}
process.exit(bad ? 1 : 0);
