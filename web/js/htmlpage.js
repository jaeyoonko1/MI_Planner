import { api } from "./api.js";

// Blocks every network request from inside the iframe (offline rule).
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Renders an html-type page in a sandboxed iframe (no allow-same-origin).
// The page can persist small state via postMessage:
//   parent.postMessage({ miPlanner: "state-get", id }, "*")
//   parent.postMessage({ miPlanner: "state-set", id, state }, "*")
export async function renderHtmlPage(host, page) {
  host.replaceChildren();
  const { external } = await api.externalRefs(page.path);
  if (external.length) {
    const badge = el("div", "warn-badge", `⚠ 외부 요청 ${external.length}건 감지 — 오프라인에서는 동작하지 않으며 차단됩니다.`);
    badge.title = external.join("\n");
    host.append(badge);
  }
  const frame = document.createElement("iframe");
  frame.className = "html-frame";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${CSP}">` + (page.content || "");
  host.append(frame);

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
