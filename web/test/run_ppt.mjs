import assert from "node:assert/strict";
import { extOf, formatSize, itemState, linkProblem, slideLabel, stageKind, stepSlide, uploadProblem } from "../js/ppt-model.js";

assert.equal(formatSize(512), "512B");
assert.equal(formatSize(2048), "2KB");
assert.equal(formatSize(5 * 1048576), "5.0MB");
assert.equal(extOf("D:\\a\\Deck.PPTX"), ".pptx");
assert.equal(extOf("noext"), "");

assert.equal(linkProblem(""), "");
assert.equal(linkProblem('"D:\\보고\\주간.pptx"'), "");
assert.equal(linkProblem("\\\\srv\\share\\a.pptm"), "");
assert.equal(linkProblem("C:/x/a.ppt"), "");
assert.match(linkProblem("보고\\a.pptx"), /전체 경로/);
assert.match(linkProblem("\\\\srv"), /전체 경로/);
assert.match(linkProblem("D:\\a\\..\\b.pptx"), /\.\./);
assert.match(linkProblem("D:\\a\\b.exe"), /PowerPoint/);
assert.match(linkProblem("D:\\a\\b.pptx.bat"), /PowerPoint/);

assert.equal(uploadProblem(null), "");
assert.equal(uploadProblem({ name: "a.pptx", size: 10 }), "");
assert.match(uploadProblem({ name: "a.docx", size: 10 }), /PowerPoint/);
assert.match(uploadProblem({ name: "a.pptx", size: 301 * 1048576 }), /링크만/);
assert.match(uploadProblem({ name: "a.pptx", size: 0 }), /빈 파일/);

assert.equal(itemState({ mode: "link", missing: true }).tone, "bad");
assert.equal(itemState({ mode: "link", changed: true }).tone, "warn");
assert.equal(itemState({ mode: "upload" }).label, "보관함에 복사됨");
assert.equal(itemState({ mode: "link" }).label, "링크");
assert.equal(itemState({ mode: "link", missing: true, changed: true }).tone, "bad");

assert.equal(stepSlide(0, "ArrowLeft", 5), 0);
assert.equal(stepSlide(4, "ArrowRight", 5), 4);
assert.equal(stepSlide(1, "ArrowRight", 5), 2);
assert.equal(stepSlide(3, "Home", 5), 0);
assert.equal(stepSlide(1, "End", 5), 4);
assert.equal(stepSlide(2, "x", 5), 2);
assert.equal(stepSlide(0, "End", 0), 0);

assert.equal(stageKind({ rendered: true, images: [{}] }), "rendered");
assert.equal(stageKind({ images: [{}] }), "images");
assert.equal(stageKind({ images: [] }), "text");
assert.equal(slideLabel({ title: " 제목 " }, 2), "2. 제목");
assert.equal(slideLabel({ title: "" }, 3), "3. (제목 없음)");
console.log("ppt ok");
