import { api } from "./api.js";
import { icon } from "./icons.js";
import { el, emptyState, store } from "./ui.js";

// Blocks every network request from inside the iframe (offline rule).
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'";

const SIZES = [["fit", "화면에 맞춤"], ["tall", "길게"]];
const SIZE_KEY = "mi.htmlFrameSize";

function button(cls, label, ic, onClick) {
  const b = el("button", cls);
  b.type = "button";
  if (ic) b.append(icon(ic, "i s"));
  b.append(el("span", "", label));
  b.addEventListener("click", onClick);
  return b;
}

function externalNotice(urls) {
  const box = el("details", "html-warn");
  const sum = el("summary");
  sum.append(icon("alert", "i s"), el("span", "", `외부 요청 ${urls.length}건 감지`),
    el("small", "", "오프라인에서는 동작하지 않으며 모두 차단됩니다"));
  const list = el("ul", "html-warn-list");
  urls.forEach((u) => list.append(el("li", "", u)));
  box.append(sum, list);
  return box;
}

function sizeChips(frame) {
  const wrap = el("div", "chips");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "문서 영역 크기");
  const paint = (cur) => {
    frame.dataset.size = cur;
    wrap.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.value === cur)));
  };
  for (const [value, label] of SIZES) {
    const c = el("button", "chip", label);
    c.type = "button";
    c.dataset.value = value;
    c.addEventListener("click", () => { store.set(SIZE_KEY, value); paint(value); });
    wrap.append(c);
  }
  paint(store.get(SIZE_KEY, "fit") === "tall" ? "tall" : "fit");
  return wrap;
}

// Renders an html-type page in a sandboxed iframe (no allow-same-origin).
// The page can persist small state via postMessage:
//   parent.postMessage({ miPlanner: "state-get", id }, "*")
//   parent.postMessage({ miPlanner: "state-set", id, state }, "*")
export async function renderHtmlPage(host, page) {
  host.replaceChildren();
  if (!(page.content || "").trim()) {
    host.append(emptyState({
      title: "아직 내용이 없는 HTML 페이지예요",
      desc: "이 폴더의 index.html에 문서를 저장하면 여기에 격리된 상태로 표시됩니다.",
      icon: "code",
      action: { label: "다시 확인", run: () => window.dispatchEvent(new HashChangeEvent("hashchange")) },
    }));
    return;
  }
  let external = [];
  try {
    external = (await api.externalRefs(page.path)).external;
  } catch { /* the scan is advisory; the sandbox and CSP still block everything */ }

  const frame = el("iframe", "html-frame");
  frame.title = `${page.meta.title} (HTML 문서)`;
  frame.setAttribute("sandbox", "allow-scripts");
  const load = () => {
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${CSP}">` + page.content;
  };

  const bar = el("div", "html-bar");
  const status = el("span", "html-secure");
  status.title = "스크립트만 허용, 네트워크·부모 화면·저장소 접근 차단";
  status.append(icon("lock", "i s"), el("span", "", "격리 실행"));
  const reload = button("btn ghost sm", "새로고침", "refresh", load);
  reload.title = "문서를 처음 상태로 다시 불러오기";
  bar.append(status, el("span", "grow"), sizeChips(frame), reload);

  host.append(bar);
  if (external.length) host.append(externalNotice(external));
  host.append(frame);
  load();

  const onMessage = async (ev) => {
    if (ev.source !== frame.contentWindow || !ev.data || !ev.data.miPlanner) return;
    const { miPlanner: kind, id } = ev.data;
    const reply = (payload) => frame.contentWindow.postMessage({ miPlanner: "reply", id, ...payload }, "*");
    try {
      if (kind === "state-get") reply({ state: (await api.getState(page.path)).state });
      else if (kind === "state-set") reply({ state: (await api.putState(page.path, ev.data.state)).state });
    } catch (e) {
      reply({ error: e.message });
    }
  };
  window.addEventListener("message", onMessage);
  // drop the listener once this view is replaced
  const obs = new MutationObserver(() => {
    if (!host.isConnected || !host.contains(frame)) {
      window.removeEventListener("message", onMessage);
      obs.disconnect();
    }
  });
  obs.observe(document.getElementById("view"), { childList: true, subtree: true });
}
