// Pasting a document into a note (V-007): OneNote / Word / Outlook / web clipboard HTML -> note blocks.
// The pure conversion lives in paste-doc.js. This file does the parts that need the browser: storing the pictures through
// the page's files API, putting the blocks into the editor, and the "paste options" bar with undo.
import { hidePasteChip, showPasteChip } from "./paste-chip.js";
import { DOC_LIMITS, classifyImageSrc, decodeDataUri, describeDoc, docHasContent, docNotes, docToMarkdown, inlineMarkdown, isInlineDoc } from "./paste-doc.js";
import { inlineToHtml, mdToHtml } from "./mdconv.js";
import { toast } from "./toast.js";

const IMAGE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" };
const SOURCE_ATTRS = ["data-gap", "data-i", "data-pre", "data-end", "data-sig"];

/** Reads every picture the HTML refers to that the browser may read and stores it. Returns { refs, failed }. */
export async function storeImages(images, { upload, onProgress }) {
  const refs = new Map();
  const failed = { file: 0, web: 0, other: 0, unsupported: 0, big: 0, error: 0 };
  let done = 0;
  for (const image of images) {
    const kind = classifyImageSrc(image.src);
    try {
      let file = null;
      if (kind === "data") {
        const data = decodeDataUri(image.src);
        if (!data) { failed.unsupported++; continue; }
        if (data.bytes.length > DOC_LIMITS.imageBytes) { failed.big++; continue; }
        file = new File([data.bytes], "image" + data.ext, { type: data.type });
      } else if (kind === "blob" || kind === "app") { // our own origin only: never an outside address
        const res = await fetch(image.src);
        if (!res.ok) throw new Error("read failed");
        const blob = await res.blob();
        const type = (blob.type || "").toLowerCase().replace("image/jpg", "image/jpeg");
        if (!IMAGE_EXT[type]) { failed.unsupported++; continue; }
        if (blob.size > DOC_LIMITS.imageBytes) { failed.big++; continue; }
        file = new File([blob], "image" + IMAGE_EXT[type], { type });
      } else {
        failed[kind === "file" ? "file" : kind === "web" ? "web" : "other"]++;
        continue;
      }
      onProgress?.(++done, images.length);
      refs.set(image.src, await upload(file, file.name));
    } catch {
      failed.error++;
    }
  }
  return { refs, failed };
}

/**
 * ctx: { ed, fileUrl, upload(file, name) -> rel, noteTables, setStatus, schedule, applyFolds }
 * returns { pasteDoc(block) -> Promise<{ done, notes }> }  (done false: nothing could be written, the caller falls back)
 */
export function createNotePaste(ctx) {
  const { ed, fileUrl, upload, noteTables, setStatus, schedule, applyFolds } = ctx;
  const eol = () => ed.dataset.eol || "\n";

  function caretTop() {
    const anchor = getSelection()?.anchorNode;
    if (!anchor || !ed.contains(anchor)) return null;
    let top = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
    while (top && top !== ed && top.parentElement !== ed) top = top.parentElement;
    return top && top !== ed ? top : null;
  }
  const emptyLine = (node) => !node.textContent.trim() && !node.querySelector("img,table") && !node.hasAttribute("data-raw");

  /** markdown -> editor blocks. Typed-looking blocks lose their file bookkeeping (they are new), raw blocks keep their text. */
  function nodesFor(md) {
    const template = document.createElement("template");
    template.innerHTML = mdToHtml(md, fileUrl);
    return [...template.content.children].map((node) => {
      SOURCE_ATTRS.forEach((name) => node.removeAttribute(name));
      if (!node.hasAttribute("data-raw")) node.removeAttribute("data-src");
      return node;
    });
  }

  function placeCaret(target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertBlocks(nodes) {
    const top = caretTop();
    let replaced = null;
    if (top && emptyLine(top)) { replaced = top; top.replaceWith(...nodes); }
    else if (top) top.after(...nodes);
    else ed.append(...nodes);
    let trailing = null;
    const last = nodes[nodes.length - 1];
    if (!last.nextElementSibling) { // keep an empty line after the paste to continue typing
      trailing = document.createElement("div");
      trailing.append(document.createElement("br"));
      last.after(trailing);
    }
    return { replaced, trailing };
  }

  function finish(nodes, trailing) {
    noteTables.refresh();
    applyFolds();
    ed.focus({ preventScroll: true });
    placeCaret(trailing || nodes[nodes.length - 1].nextElementSibling || nodes[nodes.length - 1]);
    (trailing || nodes[nodes.length - 1]).scrollIntoView?.({ block: "nearest" });
    schedule();
  }

  async function pasteDoc(block) {
    const sel = getSelection();
    const hadSelection = sel?.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode);
    let stored = { refs: new Map(), failed: {} };
    if (block.images.length) {
      stored = await storeImages(block.images, {
        upload,
        onProgress: (done, total) => setStatus("그림 저장 중… " + done + "/" + total),
      });
      setStatus("");
    }
    const { refs, failed } = stored;
    const notes = docNotes(block, failed);
    if (!docHasContent(block, refs)) return { done: false, notes };
    if (hadSelection) document.execCommand("delete");

    if (isInlineDoc(block)) { // a formatted phrase: goes into the line, the browser's own undo handles it
      document.execCommand("insertHTML", false, inlineToHtml(inlineMarkdown(block, true), fileUrl));
      schedule();
      return { done: true, notes };
    }

    let format = true;
    let nodes = nodesFor(docToMarkdown(block, { format, refs, eol: eol() }));
    if (!nodes.length) return { done: false, notes };
    const { replaced, trailing } = insertBlocks(nodes);
    finish(nodes, trailing);

    const entry = noteTables.remember(() => {
      if (!ed.isConnected || !nodes.every((node) => node.isConnected)) return false;
      if (replaced) nodes[0].before(replaced);
      nodes.forEach((node) => node.remove());
      trailing?.remove();
      hidePasteChip();
      noteTables.refresh();
      applyFolds();
      schedule();
      return true;
    });
    const restyle = (value) => {
      format = value;
      const next = nodesFor(docToMarkdown(block, { format, refs, eol: eol() }));
      if (!next.length || !nodes.every((node) => node.isConnected)) return;
      nodes[0].before(...next);
      nodes.forEach((node) => node.remove());
      nodes = next;
      noteTables.refresh();
      applyFolds();
      schedule();
    };

    showPasteChip({
      message: (block.source ? block.source + " 내용을 " : "서식을 ") + "변환해 붙여넣었어요",
      notes: [describeDoc(block, refs.size), ...notes].filter(Boolean),
      canFormat: block.hasFormat,
      format,
      onFormat: restyle,
      onUndo: () => {
        if (nodes.every((node) => node.isConnected)) { noteTables.forget(entry); entry.run(); }
        else toast("이미 내용이 바뀌어서 되돌릴 수 없어요.", { error: true });
      },
    });
    return { done: true, notes };
  }

  return { pasteDoc, hide: hidePasteChip };
}
