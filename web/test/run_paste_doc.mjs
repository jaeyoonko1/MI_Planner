// V-007: OneNote / Word / Outlook / web clipboard HTML -> note document markdown. Fake content only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOC_LIMITS, classifyImageSrc, decodeDataUri, describeDoc, docHasContent, docNotes, docToMarkdown, escapeLineStart, inlineMarkdown,
  isInlineDoc, isPlainLine, leadingIndent, planPaste,
} from "../js/paste-doc.js";
import { parseHtml, safeHref, sizePreset, textPreset } from "../js/paste-html.js";
import { joinBlocks, listTree, segment } from "../js/mdblocks.js";
import { inlineToHtml, markdownUrl } from "../js/mdconv.js";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const docOf = (html) => {
  const plan = planPaste({ html, text: "" });
  assert.equal(plan?.kind, "doc", "expected a document plan");
  return plan.block;
};
const refsFor = (block) => new Map(block.images.filter((image) => classifyImageSrc(image.src) === "data").map((image, i) => [image.src, `files/image${i}.png`]));
const lines = (md) => md.split("\n");

// ---- OneNote desktop ---------------------------------------------------------------------------------------------
{
  const block = docOf(fixture("onenote-desktop-clipboard.html"));
  assert.equal(block.source, "OneNote");
  const refs = refsFor(block);
  const md = docToMarkdown(block, { refs });
  const out = lines(md);
  // title: 16pt on an 11pt document -> 22px preset, bold, blue family color
  assert.ok(md.startsWith('<span style="color:#1a73e8;font-size:22px">**장비 점검 계획 (가짜 예시)**</span>\n'), md.slice(0, 120));
  assert.ok(md.includes("EQ-A01 설비의 **정기 점검**을 *다음 주*에 진행한다. <u>밑줄</u>과 ~~취소선~~ 확인."));
  // indentation: margin-left steps, leading nbsp x4, leading tabs, mso-tab-count
  assert.ok(out.includes("  한 단계 들여쓴 설명 문단"));
  assert.ok(out.includes("    두 단계 들여쓴 문단"));
  assert.ok(out.includes("  공백 네 칸으로 들여쓴 줄"));
  assert.ok(out.includes("    탭 두 개로 들여쓴 줄"));
  assert.ok(out.includes("  탭 칸 표시가 있는 줄"));
  assert.ok(!md.includes("\u00a0")); // no stray non-breaking spaces
  // inline presets: colors, highlights, sizes
  assert.ok(md.includes('<span style="color:#d93025">빨간 글자</span>, <span style="color:#1a73e8">파란 글자</span>'));
  assert.ok(md.includes("<mark>노란 형광펜</mark>"));
  assert.ok(md.includes('<mark style="background:#a5f3a5">초록 형광펜</mark>'));
  assert.ok(md.includes('<span style="font-size:13px">작은 글자</span>'));
  assert.ok(md.includes('<span style="font-size:28px">큰 글자</span>'));
  // lists: OneNote nests <ul> directly inside <ul>
  const at = out.indexOf("- 첫째 항목");
  assert.deepEqual(out.slice(at, at + 5), ["- 첫째 항목", "- 둘째 항목", "  - 둘째의 하위 항목", "    - 더 깊은 항목", "- 셋째 항목"]);
  assert.ok(out.includes("1. 번호 하나") && out.includes("2. 번호 둘"));
  // to-do tags: glyph, data-tag, nested star
  assert.ok(out.includes("- [ ] 시료 준비 확인 (할 일)"));
  assert.ok(out.includes("- [x] 레시피 백업 완료"));
  assert.ok(out.includes("- [!] 납기 전 반드시 확인"));
  assert.ok(out.includes("  - [*] 별 표시한 하위 메모"));
  // links: safe ones kept, javascript: dropped (text stays)
  assert.ok(md.includes("[설비 가이드](https://docs.example.com/guide?id=7)"));
  assert.ok(md.includes("그리고 위험한 링크") && !md.includes("javascript"));
  // table through the V-001 converter, then a paragraph, then the stored picture
  assert.ok(md.includes("| **항목** | **값** |\n| --- | --- |\n| EQ-A01 | 007.00 |"));
  assert.ok(out.includes("표 아래 문단"));
  assert.ok(out.includes("![Shot](files/image0.png)"));
  // the picture that only exists as a local file path is not written (nothing to point at) and is reported
  assert.equal(refs.size, 1);
  assert.ok(!md.includes("file:///") && !md.includes("clip_image"));
  assert.ok(!out.some((line) => /Description automatically/.test(line)));
  const notes = docNotes(block, { file: 1 });
  assert.match(notes[0], /파일 경로/);
  // office bloat is gone
  for (const bad of ["MsoNormal", "<o:p>", "mso-", "font-family", "margin", "<p", "<div", "<!--", "맑은 고딕"]) assert.ok(!md.includes(bad), bad);
  // stats / description
  assert.equal(block.stats.tables, 1);
  assert.equal(block.stats.todos, 4);
  assert.match(describeDoc(block, 1), /문단 \d+ · 목록 \d+ \(할일 4\) · 표 1 · 그림 1/);
  assert.equal(block.hasFormat, true);

  // text only: structure stays, styling goes, links lose the address
  const plain = docToMarkdown(block, { refs, format: false });
  assert.ok(plain.includes("EQ-A01 설비의 정기 점검을 다음 주에 진행한다. 밑줄과 취소선 확인."));
  assert.ok(!/\*\*|<u>|<mark|<span|~~|(?<!!\[[^\]]*)\]\(/.test(plain), plain);
  assert.ok(plain.includes("- [x] 레시피 백업 완료") && plain.includes("    - 더 깊은 항목") && plain.includes("| 항목 | 값 |"));
  assert.ok(plain.includes("참고 문서: 설비 가이드 그리고"));
}

// ---- the markdown is what the editor reads back: block structure, list nesting, marks, byte-exact re-join ------------------
{
  const block = docOf(fixture("onenote-desktop-clipboard.html"));
  const md = docToMarkdown(block, { refs: refsFor(block) });
  const seg = segment(md);
  assert.equal(joinBlocks(seg), md); // segment keeps every byte, so loading the markdown and saving it untouched is identical
  const kinds = seg.blocks.map((b) => b.kind);
  assert.ok(kinds.includes("table") && kinds.includes("list") && kinds.includes("p"));
  const bullets = seg.blocks.find((b) => b.src.startsWith("- 첫째 항목"));
  const tree = listTree(bullets.src);
  assert.equal(tree.length, 3);
  assert.equal(tree[1].kids[0].text, "둘째의 하위 항목");
  assert.equal(tree[1].kids[0].kids[0].text, "더 깊은 항목");
  const todos = listTree(seg.blocks.find((b) => b.src.startsWith("- [ ] 시료")).src);
  assert.deepEqual(todos.map((n) => n.mark), [" ", "x", "!"]);
  assert.equal(todos[2].kids[0].mark, "*");
  // paragraph indentation is the editor's own 2-spaces-per-level
  const indented = seg.blocks.find((b) => b.src.includes("두 단계 들여쓴"));
  assert.equal(indented.kind, "p");
  assert.equal(indented.src.match(/^ */)[0].length, 4);
  // stable: writing the same document twice gives the same text
  assert.equal(docToMarkdown(block, { refs: refsFor(block) }), md);
}

// ---- OneNote web: flat lists with data-aria-level, data-tag, EOP spans ------------------------------------------------
{
  const block = docOf(fixture("onenote-web-clipboard.html"));
  assert.equal(block.source, "OneNote 웹");
  const out = lines(docToMarkdown(block));
  assert.equal(out[0], '<span style="font-size:22px">**웹 노트 제목**</span>');
  assert.ok(out.includes("  들여쓴 **굵은 글**")); // 48px = one level; the document's own 11pt is the normal size
  const at = out.indexOf("- 웹 불릿 하나");
  assert.deepEqual(out.slice(at, at + 3), ["- 웹 불릿 하나", "  - 웹 불릿 하위", "- 웹 불릿 둘"]);
  assert.ok(out.includes("1. 웹 번호 하나"));
  assert.ok(out.includes("- [ ] 웹 할 일") && out.includes("- [x] 웹 완료한 일"));
}

// ---- Word: conditional comments, mso-list, headings, <o:p>, highlight --------------------------------------------------
{
  const block = docOf(fixture("word-clipboard.html"));
  assert.equal(block.source, "Word");
  const md = docToMarkdown(block);
  const out = lines(md);
  assert.equal(out[0], '# <span style="color:#1a73e8">보고서 제목 (가짜)</span>'); // h1: no bold, no size, theme blue
  assert.ok(out.includes("본문 첫 줄 **굵게** 그리고 <span style=\"color:#d93025\">빨강</span>"));
  assert.ok(out.includes('## <span style="color:#1a73e8">작은 제목</span>'));
  const at = out.indexOf("- 워드 불릿 하나");
  assert.deepEqual(out.slice(at, at + 3), ["- 워드 불릿 하나", "  - 워드 불릿 하위", "- 워드 불릿 둘"]);
  assert.ok(out.includes("1. 워드 번호 하나") && out.includes("2. 워드 번호 둘"));
  assert.ok(out.includes("  들여쓴 일반 문단 <mark>형광펜</mark>")); // mso-highlight
  assert.ok(out.includes("[링크 텍스트](https://docs.example.com/word) / https://docs.example.com/same")); // address as text: no brackets
  assert.ok(md.includes("| 이름 | 값 |\n| --- | --- |\n| EQ-A01 | 12 |"));
  for (const bad of ["Mso", "o:p", "mso", "supportLists", "·", "Symbol", "Times New Roman", "[if", "endif"]) assert.ok(!md.includes(bad), bad);
}

// ---- sanitizing: scripts, handlers, external pictures, dangerous links ------------------------------------------------
{
  const html = fixture("web-hostile-clipboard.html");
  const block = docOf(html);
  const md = docToMarkdown(block, { refs: new Map() });
  for (const bad of ["__pwned", "script", "onclick", "onerror", "alert", "javascript", "vbscript", "evil.example.com", "iframe", "<object"]) {
    assert.ok(!md.includes(bad), bad + " leaked into the note");
  }
  const visible = md.replace(/<\/?span[^>]*>/g, "");
  assert.ok(visible.includes("안전한 문단 클릭 속성") && visible.includes("js 링크 vb 링크"), md);
  assert.ok(md.includes("[정상 링크](https://ok.example.com/a%20b%281%29)"));
  assert.equal(classifyImageSrc("https://evil.example.com/track.png"), "web"); // never fetched: only data:, blob: and /api/ are read
  assert.equal(classifyImageSrc("file:///C:/x.png"), "file");
  assert.equal(classifyImageSrc("C:\\x\\y.png"), "file");
  assert.equal(classifyImageSrc("/api/pages/file?path=a&name=b.png"), "app");
  assert.equal(classifyImageSrc("data:image/png;base64,AAAA"), "data");
  assert.equal(classifyImageSrc("blob:http://127.0.0.1:8765/abc"), "blob");
  assert.equal(classifyImageSrc("cid:image001.png@01"), "other");
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref(" JaVaScRiPt:alert(1)"), "");
  assert.equal(safeHref("data:text/html;base64,AAAA"), "");
  assert.equal(safeHref("https://a.example.com/x"), "https://a.example.com/x");
  assert.equal(safeHref("onenote:https://d.example.com/page.one#sec"), "onenote:https://d.example.com/page.one#sec");
  // nothing storable: a picture that cannot be read is not content, so the caller falls back to the clipboard bitmap
  const pictureOnly = docOf('<html><body><!--StartFragment--><img src="file:///C:/Users/fake/clip_image001.png" width=300 height=200><!--EndFragment--></body></html>');
  assert.equal(pictureOnly.images.length, 1);
  assert.equal(docHasContent(pictureOnly, new Map()), false);
  assert.equal(docHasContent(pictureOnly, new Map([[pictureOnly.images[0].src, "files/a.png"]])), true);
  assert.equal(docToMarkdown(pictureOnly, { refs: new Map() }), "");
  // data: pictures
  const png = decodeDataUri("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
  assert.equal(png.ext, ".png");
  assert.equal(png.type, "image/png");
  assert.deepEqual([...png.bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(decodeDataUri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null); // svg can carry script: not stored
  assert.equal(decodeDataUri("data:image/x-emf;base64,AAAA"), null);
  assert.equal(decodeDataUri("data:image/png;base64,"), null);
}

// ---- what is a document, what stays a table, what stays plain text ----------------------------------------------------
{
  assert.equal(planPaste({ html: fixture("excel-clipboard.html"), text: "a\tb" }).kind, "table"); // a sheet is still a sheet
  assert.equal(planPaste({ html: fixture("sheets-clipboard.html"), text: "a\tb" }).kind, "table");
  assert.equal(planPaste({ html: "", text: "a\tb\nc\td\ne\tf" }).via, "tsv");
  assert.equal(planPaste({ html: "<html><body><!--StartFragment--><span>그냥 한 줄</span><!--EndFragment--></body></html>", text: "그냥 한 줄" }), null);
  assert.equal(planPaste({ html: "", text: "그냥 한 줄" }), null);
  // a document that has a table and text is a document (the table becomes one block inside it)
  const mixed = planPaste({ html: "<p>설명</p><table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>", text: "설명\na\tb\n1\t2" });
  assert.equal(mixed.kind, "doc");
  assert.equal(mixed.block.stats.tables, 1);
  // a layout table with one cell (Outlook) is just a wrapper
  const wrapped = docOf("<table><tr><td><p>바깥 표 안의 문단</p><ul><li>목록</li></ul></td></tr></table>");
  assert.deepEqual(lines(docToMarkdown(wrapped)).filter(Boolean), ["바깥 표 안의 문단", "", "- 목록"].filter(Boolean));
  // one formatted phrase is pasted inline, one plain phrase is plain text
  const phrase = docOf("<span style='font-weight:bold'>굵은 말</span>");
  assert.equal(isInlineDoc(phrase), true);
  assert.equal(inlineMarkdown(phrase), "**굵은 말**");
  assert.equal(isPlainLine(docOf("<b>x</b>")), false);
  assert.equal(planPaste({ html: "<span>x</span>", text: "x" }), null);
  assert.equal(isInlineDoc(docOf("<p style='margin-left:.5in'>들여쓴 한 줄 <b>굵게</b></p>")), false);
  // a copy from this app's own editor keeps marks, indentation and raw blocks
  const own = docOf('<div data-src="a" data-indent="1" style="--note-depth:1">안쪽</div><ul><li data-m="x">끝낸 일</li></ul><div class="raw" data-raw="1" data-k="table" data-src="| A | B |\n| --- | --- |\n| 1 | 2 |"><table><tr><td>zzz</td></tr></table></div>');
  const ownMd = lines(docToMarkdown(own));
  assert.ok(ownMd.includes("  안쪽") && ownMd.includes("- [x] 끝낸 일") && ownMd.includes("| A | B |") && !ownMd.some((l) => l.includes("zzz")));
}

// ---- escaping: nothing the user pasted may turn into structure ---------------------------------------------------------
{
  const block = docOf("<p># 샵으로 시작</p><p>- 대시로 시작</p><p>1. 번호처럼 보임</p><p>&gt; 인용처럼 보임</p><p>| 파이프 시작 |</p><p>별 *두 개* 와 `코드` 와 ~~물결~~</p><p>&lt;u&gt;태그처럼&lt;/u&gt; &lt;!-- 주석 --&gt;</p><p>&lt;!-- 줄 시작 주석 --&gt;</p><ul><li>[x] 대괄호 시작</li></ul>");
  const md = docToMarkdown(block);
  const seg = segment(md);
  assert.deepEqual(seg.blocks.slice(0, 8).map((b) => b.kind), ["p", "p", "p", "p", "p", "p", "p", "p"]);
  assert.equal(seg.blocks[8].kind, "list");
  assert.equal(listTree(seg.blocks[8].src)[0].mark, null); // "[x]" typed as text is not a to-do mark
  assert.equal(escapeLineStart("2) 문장"), "2\\) 문장");
  assert.ok(md.includes("\\# 샵으로 시작") && md.includes("\\- 대시로") && md.includes("1\\. 번호처럼") && md.includes("\\> 인용") && md.includes("\\| 파이프"));
  assert.ok(md.includes("별 \\*두 개\\* 와 \\`코드\\` 와 \\~\\~물결\\~\\~"));
  assert.ok(md.includes("\\<u>태그처럼\\</u>") && md.includes(" <!-- 주석 -->") && md.includes("\\<!-- 줄 시작 주석 -->"));
}

// ---- relationships between presets -------------------------------------------------------------------------------------
{
  assert.equal(sizePreset((11 * 4) / 3, (11 * 4) / 3), 0); // the normal size
  assert.equal(sizePreset((16 * 4) / 3, (11 * 4) / 3), 22);
  assert.equal(sizePreset((20 * 4) / 3, (11 * 4) / 3), 28);
  assert.equal(sizePreset((9 * 4) / 3, (11 * 4) / 3), 13);
  assert.equal(sizePreset((8 * 4) / 3, (11 * 4) / 3), 11);
  assert.equal(textPreset("#1E4E79"), "#1a73e8"); // dark navy is the blue family
  assert.equal(textPreset("rgb(192,0,0)"), "#d93025");
  assert.equal(textPreset("#7030A0"), "#7b1fa2");
  assert.equal(textPreset("windowtext"), "");
  assert.equal(textPreset("#000000"), "");
  // a document set in 10pt reads as normal text, its 14pt line as a bigger one
  const small = docOf("<body style='font-size:10pt'><p>가나다라마바사 본문 본문 본문 본문</p><p>본문 본문 본문 본문 본문 본문</p><p style='font-size:14pt'>큰 줄</p></body>");
  const out = lines(docToMarkdown(small)).filter(Boolean);
  assert.ok(out[0].startsWith("가나다라") && !out[0].includes("<span"));
  assert.equal(out[2], '<span style="font-size:22px">큰 줄</span>');
  // leading indentation helper
  const p = (html) => parseHtml(html).root.children[0];
  assert.equal(leadingIndent(p("<p>\t\t텍스트</p>")), 2);
  assert.equal(leadingIndent(p("<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;텍스트</p>")), 2);
  assert.equal(leadingIndent(p("<p>&nbsp;&nbsp;텍스트</p>")), 0);
  assert.equal(leadingIndent(p("<p><span style='mso-tab-count:3'>&nbsp;&nbsp;</span>텍스트</p>")), 3);
  assert.equal(leadingIndent(p("<p>텍스트&nbsp;&nbsp;&nbsp;&nbsp;끝</p>")), 0);
}

// ---- OneNote To Do tags that arrive as small pictures ------------------------------------------------------------------
{
  const block = docOf('<p><img width=16 height=16 alt="To Do tag" src="data:image/png;base64,AAAA"> 그림으로 온 할 일</p><p><img width=16 height=16 alt="To Do tag, completed" src="x.png"> 끝낸 일</p><p><img alt="Important tag" src="x.png"> 중요</p><p><img width=400 height=300 alt="화면" src="data:image/png;base64,AAAA"></p>');
  const out = lines(docToMarkdown(block, { refs: new Map([[block.images[0].src, "files/x.png"]]) }));
  assert.ok(out.includes("- [ ] 그림으로 온 할 일") && out.includes("- [x] 끝낸 일") && out.includes("- [!] 중요"), out.join("|"));
  assert.ok(out.includes("![화면](files/x.png)"));
  assert.equal(block.images.length, 1); // tag pictures are marks, not pictures
}

// ---- limits: huge pastes, hostile nesting -------------------------------------------------------------------------------
{
  const many = "<p>줄 번호 가짜</p>".repeat(DOC_LIMITS.items + 500);
  const t0 = Date.now();
  const big = docOf(many);
  assert.equal(big.items.length, DOC_LIMITS.items);
  assert.equal(big.truncated, true);
  assert.match(docNotes(big)[0], /앞쪽 4,000줄만/);
  assert.ok(Date.now() - t0 < 4000, "4,500 paragraphs should convert in a few seconds");
  const pictures = docOf(Array.from({ length: DOC_LIMITS.images + 5 }, (_, i) => `<p><img width=100 height=100 src="data:image/png;base64,AAA${i}"></p>`).join(""));
  assert.equal(pictures.images.length, DOC_LIMITS.images);
  assert.equal(pictures.skippedImages, 5);
  assert.ok(docNotes(pictures).some((n) => /30개까지만/.test(n)));
  // absurd nesting must not throw out of the paste handler
  const deep = "<div>".repeat(20000) + "깊다" + "</div>".repeat(20000);
  assert.doesNotThrow(() => planPaste({ html: deep, text: "깊다" }));
  // a very long single html (bigger than the cap) is cut instead of parsed whole
  const huge = "<p>가짜 문단 하나</p>".repeat(Math.ceil(DOC_LIMITS.html / 12) + 10);
  assert.ok(huge.length > DOC_LIMITS.html);
  const hugePlan = planPaste({ html: huge, text: "" });
  assert.equal(hugePlan.kind, "doc");
  assert.equal(hugePlan.block.truncated, true);
}

// ---- links in the note: [text](url) is read as a link, only safe addresses --------------------------------------------------
{
  const html = inlineToHtml("앞 [링크](https://e.example.com/a%20b) **굵게** 뒤", (f) => f);
  assert.ok(html.includes('<a href="https://e.example.com/a%20b" data-md="1"'), html);
  assert.ok(html.includes(">링크</a>") && html.includes("<b>굵게</b>"));
  assert.ok(!inlineToHtml("[x](javascript:alert(1))", (f) => f).includes("<a "));
  assert.ok(!inlineToHtml("[x](files/a.png)", (f) => f).includes("<a "));
  assert.ok(inlineToHtml("![alt](files/a.png)", (f) => "/u/" + f).includes("<img")); // a picture is still a picture
  assert.ok(!inlineToHtml("\\[x](https://e.example.com)", (f) => f).includes("<a ")); // an escaped bracket is text
  assert.equal(markdownUrl("https://a.example.com/x y(1)*"), "https://a.example.com/x%20y%281%29%2A");
}

// ---- Korean text is untouched ------------------------------------------------------------------------------------------
{
  const text = "반도체 검사·계측 설비의 가짜 점검표 ㅋㅋ ① ② ㈜ — “따옴표” ’작은따옴표’ 한글ABC123";
  const md = docToMarkdown(docOf(`<p><b>${text}</b></p><p>${text}</p>`));
  assert.ok(md.includes(`**${text}**`) && md.includes(`\n${text}\n`));
}

console.log("PASS paste doc: OneNote desktop/web, Word, hostile html, indentation, to-do tags, lists, links, images, limits, Korean");
