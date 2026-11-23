// Thin fetch wrapper. Server errors arrive as {"error": "..."}.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

const q = (path) => `?path=${encodeURIComponent(path)}`;

export const api = {
  tree: () => request("GET", "/api/pages/tree").then((d) => d.tree),
  page: (path) => request("GET", `/api/pages${q(path)}`),
  externalRefs: (path) => request("GET", `/api/pages/external-refs${q(path)}`),
  getState: (path) => request("GET", `/api/pages/state${q(path)}`),
  putState: (path, state) => request("PUT", `/api/pages/state${q(path)}`, { state }),
  journal: (month) => request("GET", `/api/journal/${encodeURIComponent(month)}`),
  saveDay: (month, dd, content) => request("PUT", `/api/journal/${encodeURIComponent(month)}/${dd}`, { content }),
  journalAuto: (month) => request("GET", `/api/journal/${encodeURIComponent(month)}/auto`),
  settings: () => request("GET", "/api/settings").then((d) => d.settings),
  putSetting: (key, value) => request("PUT", `/api/settings/${key}`, { value }).then((d) => d.settings),
  todos: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null && v !== false));
    return request("GET", `/api/todos?${qs}`);
  },
  getTodo: (id) => request("GET", `/api/todos/${id}`),
  todoFields: () => request("GET", "/api/todos/fields?include_archived=false").then((d) => d.items),
  fieldsAll: () => request("GET", "/api/todos/fields?include_archived=true").then((d) => d.items),
  patchField: (key, data) => request("PATCH", `/api/todos/fields/${key}`, data),
  deleteField: (key, purge = false) => request("DELETE", `/api/todos/fields/${key}${purge ? "?purge=true" : ""}`),
  addOption: (key, data) => request("POST", `/api/todos/fields/${key}/options`, data),
  structureView: () => request("GET", "/api/structure/view"),
  saveStructureView: (data) => request("PUT", "/api/structure/view", data),
  structureFree: () => request("GET", "/api/structure/free"),
  structureFreeMove: (data) => request("POST", "/api/structure/free/move", data),
  structureAddGroup: (data) => request("POST", "/api/structure/free/groups", data),
  structureCopy: (data) => request("POST", "/api/structure/copy", data),
  structureClasses: () => request("GET", "/api/structure/classes").then((d) => d.items),
  classImpact: (key) => request("GET", `/api/structure/classes/${key}/impact`),
  addTodo: (data) => request("POST", "/api/todos", data),
  patchTodo: (id, data) => request("PATCH", `/api/todos/${id}`, data),
  deleteTodo: (id) => request("DELETE", `/api/todos/${id}`),
  promoteLine: (date, line_index) => request("POST", "/api/todos/from-line", { date, line_index }),
  today: () => request("GET", "/api/dashboard/today"),
  pagePreview: (body) => request("POST", "/api/todos/page-preview", body),
  expandPage: (id, override) => request("POST", `/api/todos/${id}/page`, { override }),
  createWithPage: (body) => request("POST", "/api/todos/with-page", body),
  relocatePage: (id, override) => request("POST", `/api/todos/${id}/page/relocate`, { override }),
  pageRules: () => request("GET", "/api/todos/page-rules"),
  savePageRules: (rules, fallback) => request("PUT", "/api/todos/page-rules", { rules, fallback }),
  rulesOverview: (rules, fallback) => request("POST", "/api/todos/page-rules/overview", rules ? { rules, fallback } : {}),
  movePage: (path, data) => request("PATCH", `/api/pages${q(path)}`, data),
  create: (parent, title, type) => request("POST", "/api/pages", { parent, title, type }),
};
