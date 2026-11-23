import { appendColumn, joinColumns, layoutFor, MAX_COLUMNS, resizePair, splitColumns } from "./note-column-layout.js";

function element(tag, cls, text = "") {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function chip(text, action) {
  const button = element("button", "chip", text);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

// The surfaces share a single save queue, so typing in different columns always saves the complete note.
export function mountNoteColumns(mountEditor, cfg) {
  const { compact, content = "", save, saveLayout } = cfg;
  const root = element("div", compact ? "rich compact note-layout" : "note-layout");
  const tools = element("div", "note-layout-tools");
  const format = element("div", "note-format-host");
  const viewport = element("div", "note-column-viewport");
  const grid = element("div", "note-column-grid");
  const status = element("span", "jstatus note-layout-status");
  status.setAttribute("role", "status");
  const retry = chip("다시 저장", () => {
    if (documentError) saveDocument().catch(() => {});
    if (layoutError) persistLayout();
  });
  retry.hidden = true;
  viewport.append(grid);
  root.append(tools, format, viewport);
  let source = splitColumns(content);
  let layout = layoutFor(cfg.layout, source.parts.length);
  let currentColumn = 0;
  let last = content;
  let documentChain = Promise.resolve();
  let layoutChain = Promise.resolve();
  let pending = 0;
  let lastLayout = null;
  let documentError = false;
  let layoutError = false;
  let columns = [];
  let disposed = false;

  function updateStatus(message, bad = false) {
    status.textContent = documentError ? "본문 저장 실패" : layoutError ? "배치 저장 실패" : message;
    status.classList.toggle("error", documentError || layoutError || bad);
    retry.hidden = !(documentError || layoutError);
  }

  function presentSource() {
    return {
      ...source,
      parts: columns.map(({ editor, initial }, index) => {
        const value = editor.getMd();
        return value === initial ? source.parts[index] : value;
      }),
    };
  }

  function getMd() {
    return joinColumns(presentSource());
  }

  function saveDocument() {
    const md = getMd();
    if (!pending && md === last) return documentChain;
    pending++;
    updateStatus("저장 중…");
    const result = documentChain.then(async () => {
      if (md !== last) await save(md);
      last = md;
      documentError = false;
      updateStatus(md === getMd() ? "저장됨" : "편집 중…");
    }).catch(error => {
      documentError = true;
      updateStatus("");
      throw error;
    }).finally(() => { pending--; });
    documentChain = result.catch(() => {});
    return result;
  }

  function persistLayout() {
    if (!saveLayout) return;
    const next = { mode: layout.mode, widths: [...layout.widths] };
    const key = JSON.stringify(next);
    layoutChain = layoutChain.then(async () => {
      if (lastLayout !== key) await saveLayout(next);
      lastLayout = key;
      layoutError = false;
      updateStatus("배치 저장됨");
    }).catch(() => {
      layoutError = true;
      updateStatus("");
    });
  }

  function activate(index) {
    currentColumn = index;
    columns.forEach(({ editor }, i) => { editor.toolbar.hidden = i !== currentColumn; });
  }

  const add = chip("단 추가", () => {
    const next = appendColumn(presentSource());
    if (!next) {
      updateStatus("열린 코드 블록이나 주석을 먼저 닫아 주세요.");
      return;
    }
    // Existing surfaces retain their editing history and source baselines.
    source.separators = next.separators;
    source.parts.push(next.parts.at(-1));
    layout = layoutFor({ mode: layout.mode }, source.parts.length);
    buildColumn(source.parts.at(-1), columns.length);
    arrange();
    columns.at(-1).editor.focus();
    saveDocument().catch(() => {});
    persistLayout();
  });
  const modeButtons = new Map([
    ["fit", chip("맞춤", () => setMode("fit"))],
    ["scroll", chip("스크롤", () => setMode("scroll"))],
  ]);
  function setMode(mode) {
    if (layout.mode === mode) return;
    layout = { ...layout, mode };
    paint();
    persistLayout();
  }

  if (saveLayout) {
    tools.append(add, ...modeButtons.values());
  }
  tools.append(status, retry);

  function paint() {
    const many = columns.length > 1;
    root.dataset.columns = String(columns.length);
    root.dataset.mode = compact ? "stack" : layout.mode;
    const tracks = layout.widths.flatMap((width, index) => [
      ...(index && !compact ? ["12px"] : []), `minmax(0, ${width}fr)`,
    ]);
    grid.style.gridTemplateColumns = compact ? "minmax(0, 1fr)" : tracks.join(" ");
    grid.style.setProperty("--note-columns", String(columns.length));
    add.disabled = columns.length >= MAX_COLUMNS;
    for (const [mode, button] of modeButtons) {
      button.hidden = !many;
      button.setAttribute("aria-pressed", String(layout.mode === mode));
    }
    for (const handle of grid.querySelectorAll("[data-boundary]")) {
      const index = Number(handle.dataset.boundary);
      const left = layout.widths[index];
      const total = left + layout.widths[index + 1];
      const min = Math.min(10, Math.floor(total / 2));
      handle.setAttribute("aria-valuenow", String(left));
      handle.setAttribute("aria-valuemin", String(min));
      handle.setAttribute("aria-valuemax", String(total - min));
      handle.setAttribute("aria-valuetext", `${left}% · ${total - left}%`);
    }
  }

  function makeHandle(index) {
    const divider = element("div", "note-column-divider");
    divider.tabIndex = 0;
    divider.dataset.boundary = String(index);
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-label", `${index + 1}단과 ${index + 2}단 너비 조절`);
    divider.title = "드래그 또는 좌우 방향키로 너비 조절";
    divider.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1);
      layout.widths = resizePair(layout.widths, index, layout.widths[index] + delta);
      paint();
      persistLayout();
    });
    divider.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.focus();
      divider.setPointerCapture(event.pointerId);
      const original = layout.widths;
      const start = event.clientX;
      const measure = columns.reduce((total, col) => total + col.editor.el.getBoundingClientRect().width, 0);
      if (!measure) return;
      const move = pointer => {
        layout.widths = resizePair(original, index, original[index] + (pointer.clientX - start) * 100 / measure);
        paint();
      };
      const finish = pointer => {
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", finish);
        divider.removeEventListener("pointercancel", finish);
        divider.removeEventListener("lostpointercapture", finish);
        if (pointer.type !== "pointerup") {
          layout.widths = original;
          paint();
        } else if (layout.widths[index] !== original[index]) persistLayout();
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", finish);
      divider.addEventListener("pointercancel", finish);
      divider.addEventListener("lostpointercapture", finish);
    });
    return divider;
  }

  function buildColumn(markdown, index) {
    const editor = mountEditor({
      ...cfg,
      shared: true,
      report: updateStatus,
      content: markdown,
      label: index ? `본문 ${index + 1}단` : cfg.label || "본문",
      foldScope: index && cfg.foldScope ? `${cfg.foldScope}:column:${index + 1}` : cfg.foldScope,
      save: saveDocument,
    });
    editor.el.classList.add("note-column");
    editor.el.addEventListener("focusin", () => activate(index));
    editor.toolbar.hidden = index !== currentColumn;
    format.append(editor.toolbar);
    columns.push({ editor, initial: editor.getMd() });
  }

  function arrange() {
    const tracks = [];
    columns.forEach(({ editor }, index) => {
      if (index && !compact) tracks.push(makeHandle(index - 1));
      tracks.push(editor.el);
    });
    grid.replaceChildren(...tracks);
    paint();
  }

  function setMd(md, meta) {
    columns.forEach(({ editor }) => editor.destroy());
    columns = [];
    format.replaceChildren();
    source = splitColumns(md);
    layout = layoutFor(meta ?? layout, source.parts.length);
    last = md;
    currentColumn = 0;
    source.parts.forEach(buildColumn);
    arrange();
  }
  source.parts.forEach(buildColumn);
  arrange();

  const isBusy = () => pending > 0 || columns.some(({ editor }) => editor.isBusy());
  return {
    el: root,
    getMd,
    setMd,
    syncFrom(md) { if (!isBusy() && getMd() !== md) setMd(md); },
    isBusy,
    contains: node => root.contains(node),
    focus: () => columns[currentColumn].editor.focus(),
    async flush() {
      await Promise.all(columns.map(({ editor }) => editor.flush()));
      if (!disposed && last !== getMd()) await saveDocument().catch(() => {});
      await layoutChain;
    },
    destroy() {
      disposed = true;
      columns.forEach(({ editor }) => editor.destroy());
    },
  };
}
