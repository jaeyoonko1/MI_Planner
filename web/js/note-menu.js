// Context menu of the note editor text (V-010): clipboard, character formats (note-format.js), links, table insert.
// Tables and columns add their own groups through their own registrations; this one stays out of table cells.
import { registerContext, textGroup } from "./contextmenu.js";
import { LINK_HREF } from "./mdconv.js";
import { button, openSheet } from "./sheet.js";
import { el } from "./ui.js";

function askLink(ed, ranges, schedule, current = "") {
  const sheet = openSheet({ title: "링크 걸기", sub: "선택한 글에 주소를 걸어요. 저장 형식은 [글](주소)예요." });
  const input = el("input", "txt-in");
  input.type = "url";
  input.style.cssText = "width:100%;height:36px;font-size:13px";
  input.placeholder = "https://";
  input.value = current;
  input.setAttribute("aria-label", "링크 주소");
  const err = el("p", "error");
  err.setAttribute("role", "alert");
  const apply = () => {
    const url = input.value.trim();
    if (!LINK_HREF.test(url)) { err.textContent = "https:// · http:// · mailto: · onenote: 주소만 걸 수 있어요."; input.focus(); return; }
    sheet.close();
    ed.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(ranges);
    document.execCommand("createLink", false, url);
    ed.querySelectorAll("a[href]:not([data-md])").forEach((a) => { a.dataset.md = "1"; a.title = "Ctrl+클릭으로 열기"; });
    schedule();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); apply(); } });
  sheet.body.append(input, err);
  sheet.foot.append(button("취소", "", () => sheet.close()), button("링크 걸기", "pri", apply));
  input.focus();
  input.select();
}

export function registerNoteMenu(ed, { fmt, noteTables, schedule }) {
  return registerContext(ed, (ctx) => {
    const target = ctx.target;
    if (target.closest(".note-table, [data-raw]") || !ed.contains(target)) return null;
    const sel = getSelection();
    const hasText = Boolean(sel && !sel.isCollapsed && ed.contains(sel.anchorNode));
    const link = target.closest("a[href]");
    const live = link && ed.contains(link) ? link : null;
    const linkItems = live
      ? [
          { label: "링크 열기", icon: "open", keys: "Ctrl+클릭", disabled: !LINK_HREF.test(live.getAttribute("href") || "") && "열 수 없는 주소", run: () => window.open(live.href, "_blank", "noopener,noreferrer") },
          { label: "링크 주소 복사", icon: "copy", run: () => navigator.clipboard.writeText(live.getAttribute("href") || "") },
          { label: "링크 해제", icon: "link", run: () => {
            const range = document.createRange();
            range.selectNodeContents(live);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(range);
            document.execCommand("unlink");
            schedule();
          } },
        ]
      : [{
          label: "링크 걸기…", icon: "link",
          disabled: !hasText && "글을 먼저 선택하세요",
          run: () => askLink(ed, sel.getRangeAt(0).cloneRange(), schedule),
        }];
    return [
      textGroup(ed),
      ...fmt.menuItems(),
      linkItems,
      [{ label: "표 삽입", icon: "grid", run: () => noteTables.insert() }],
    ];
  });
}
