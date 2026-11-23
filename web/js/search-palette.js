import { api } from "./api.js";
import { icon } from "./icons.js";
import { pageHash } from "./wikilinks.js";

const text = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value) node.textContent = value;
  return node;
};
const key = value => value.trim().normalize("NFC").toLowerCase();

export function mountSearchPalette({ commands, openIssue }) {
  const trigger = document.getElementById("search-trigger");
  const modal = text("dialog", "search-palette");
  modal.id = "search-palette";
  modal.setAttribute("aria-label", "검색");
  trigger.setAttribute("aria-controls", modal.id);
  const field = text("div", "search-field");
  const input = text("input");
  input.type = "search";
  input.maxLength = 250;
  input.autocomplete = "off";
  input.placeholder = "페이지 · 할일 · 명령 검색";
  input.setAttribute("aria-label", input.placeholder);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", "search-results");
  const close = text("button", "search-close");
  close.type = "button";
  close.setAttribute("aria-label", "검색 닫기");
  close.append(text("kbd", "", "Esc"));
  field.append(icon("search"), input, close);
  const status = text("p", "search-status");
  status.setAttribute("role", "status");
  const list = text("div", "search-results");
  list.id = "search-results";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "검색 결과");
  modal.append(field, status, list);
  document.body.append(modal);

  let rows = [], flat = [], selected = 0, timer, generation = 0, previousFocus;

  function select(index, scroll = false) {
    selected = index;
    rows.forEach((button, i) => button.setAttribute("aria-selected", String(i === index)));
    const row = rows[index];
    if (row) {
      input.setAttribute("aria-activedescendant", row.id);
      if (scroll) row.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function run(index) {
    const result = flat[index];
    if (!result) return;
    modal.close();
    result.run();
  }

  function render(groups, message = "") {
    flat = [];
    rows = [];
    list.replaceChildren();
    for (const [label, items] of groups) {
      if (!items.length) continue;
      const group = text("div", "search-group");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", label);
      const heading = text("div", "search-group-label", label);
      heading.setAttribute("aria-hidden", "true");
      group.append(heading);
      for (const item of items) {
        const i = flat.push(item) - 1;
        const row = text("button", "search-result");
        row.type = "button";
        row.id = "search-result-" + i;
        row.tabIndex = -1;
        row.setAttribute("role", "option");
        const main = text("span", "search-result-main");
        main.append(text("b", "", item.title));
        if (item.snippet) main.append(text("small", "", item.snippet));
        row.append(main, text("small", "search-detail", item.detail));
        row.addEventListener("pointermove", () => { if (selected !== i) select(i); });
        row.addEventListener("click", () => run(i));
        rows.push(row);
        group.append(row);
      }
      list.append(group);
    }
    list.scrollTop = 0;
    status.textContent = message || (flat.length ? "" : "검색 결과가 없어요.");
    select(0);
  }

  function update() {
    clearTimeout(timer);
    const stamp = ++generation;
    const query = key(input.value);
    const cmds = commands.filter(command => key(command.title + " " + command.detail).includes(query));
    const commandGroup = ["명령", cmds];
    if (!query) return render([commandGroup]);
    render([commandGroup], "검색 중…");
    timer = setTimeout(async () => {
      try {
        const { pages, tasks } = await api.search(query);
        if (generation !== stamp || !modal.open) return;
        render([
          ["페이지", pages.map(page => ({
            ...page, detail: page.path, run: () => { location.hash = pageHash(page.path); },
          }))],
          ["할일", tasks.map(task => ({
            ...task, detail: "#" + task.id, run: () => openIssue(task.id),
          }))],
          commandGroup,
        ]);
      } catch {
        if (generation === stamp && modal.open) render([commandGroup], "검색 결과를 불러오지 못했어요.");
      }
    }, 140);
  }

  function open() {
    if (document.querySelector("dialog[open]")) return false;
    previousFocus = document.activeElement;
    modal.showModal();
    input.value = "";
    update();
    input.focus();
    return true;
  }

  trigger.addEventListener("click", open);
  close.addEventListener("click", () => modal.close());
  modal.addEventListener("click", event => { if (event.target === modal) modal.close(); });
  modal.addEventListener("close", () => {
    clearTimeout(timer);
    generation++;
    // Native dialog restores focus. This also covers a shell re-render that retained the opener.
    if (document.activeElement === document.body && previousFocus?.isConnected) previousFocus.focus();
  });
  input.addEventListener("input", event => { if (!event.isComposing) update(); });
  input.addEventListener("compositionend", update);
  input.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229 || !rows.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      select(Math.max(0, Math.min(rows.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1))), true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(selected);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "");
    const command = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
      && event.key.toLowerCase() === "k";
    const slash = !typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "/";
    if ((command || slash) && open()) event.preventDefault();
  });
}
