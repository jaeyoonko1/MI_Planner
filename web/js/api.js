// Thin fetch wrapper. Server errors arrive as {"error": "..."}.
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

async function rawUpload(method, url, blob) {
  const res = await fetch(url, { method, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

const q = (path) => `?path=${encodeURIComponent(path)}`;

export const api = {
  search: (q) => request("GET", "/api/search?" + new URLSearchParams({ q })),
  backlinks: (path) => request("GET", "/api/search/backlinks" + q(path)).then((d) => d.pages),
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
  uploadTodoFile: async (id, file, name) => {
    const res = await fetch(`/api/todos/${id}/files?name=${encodeURIComponent(name)}`, { method: "POST", body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data.file;
  },
  deleteTodo: (id) => request("DELETE", `/api/todos/${id}`),
  promoteLine: (date, line_index) => request("POST", "/api/todos/from-line", { date, line_index }),
  doiList: (trash = false) => request("GET", `/api/doi?trash=${trash}`).then((d) => d.items),
  doiGet: (id) => request("GET", `/api/doi/${id}`),
  doiCreate: (body) => request("POST", "/api/doi", body),
  doiPatch: (id, body) => request("PATCH", `/api/doi/${id}`, body),
  doiTrash: (id) => request("DELETE", `/api/doi/${id}`),
  doiRestore: (id) => request("POST", `/api/doi/${id}/restore`),
  doiPatchImage: (id, imageId, caption) => request("PATCH", `/api/doi/${id}/images/${imageId}`, { caption }),
  doiDeleteImage: (id, imageId) => request("DELETE", `/api/doi/${id}/images/${imageId}`),
  doiOrder: (id, ids) => request("PUT", `/api/doi/${id}/images/order`, { ids }),
  // Raw image bytes as the body; the thumbnail is a small JPEG the browser draws on a canvas (no server-side imaging).
  doiAddImage: (id, blob, { width = 0, height = 0 } = {}) => rawUpload("POST", `/api/doi/${id}/images?width=${width}&height=${height}`, blob),
  doiPutThumb: (imageId, blob) => rawUpload("PUT", `/api/doi-images/${imageId}/thumb`, blob),
  // PPT import (P5-03): raw .pptx bytes in, staged preview out; nothing is saved until confirm.
  doiImportPreview: async (file) => {
    const res = await fetch(`/api/doi-import/pptx?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
    return data;
  },
  doiImportConfirm: (token, slides) => request("POST", `/api/doi-import/${token}/confirm`, { slides }),
  doiImportCancel: (token) => fetch(`/api/doi-import/${token}`, { method: "DELETE", keepalive: true }).catch(() => {}),
  // Share package (P5-04): export returns a zip blob; import is preview (raw zip in) -> apply (choices per DOI uid).
  doiPackageExport: async (ids, sender, note) => {
    const res = await fetch("/api/doi-package/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, sender, note }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
    }
    const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "doi-package.zip";
    return { blob: await res.blob(), filename, count: Number(res.headers.get("X-Doi-Count") || ids.length) };
  },
  doiPackagePreview: async (file) => {
    const res = await fetch(`/api/doi-package/preview?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
    return data;
  },
  doiPackageApply: (token, decisions) => request("POST", `/api/doi-package/${token}/apply`, { decisions }),
  doiPackageCancel: (token) => fetch(`/api/doi-package/${token}`, { method: "DELETE", keepalive: true }).catch(() => {}),
  plans: () => request("GET", "/api/plans"),
  plan: (id) => request("GET", `/api/plans/${id}`),
  deletePlan: (id) => request("DELETE", `/api/plans/${id}`),
  // Raw .xlsx bytes as the body; options (sheet, header_row, mapping, product, source_path) travel as JSON in the query.
  importPlans: async (file, dryRun, options) => {
    const qs = new URLSearchParams({ name: file.name, dry_run: String(dryRun), options: JSON.stringify(options) });
    const res = await fetch(`/api/plans/import?${qs}`, { method: "POST", body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
    return data;
  },
  today: () => request("GET", "/api/dashboard/today"),
  evalTemplates: () => request("GET", "/api/eval-templates").then((data) => data.items),
  evalTemplateUsage: (id) => request("GET", `/api/eval-templates/${id}/usage`),
  createEvalTemplate: (body) => request("POST", "/api/eval-templates", body),
  patchEvalTemplate: (id, body) => request("PATCH", `/api/eval-templates/${id}`, body),
  deleteEvalTemplate: (id) => request("DELETE", `/api/eval-templates/${id}`),
  saveEvaluationAsTemplate: (id, body) => request("POST", `/api/evaluations/${id}/save-as-template`, body),
  evaluations: () => request("GET", "/api/evaluations").then((data) => data.items),
  evaluation: (id) => request("GET", "/api/evaluations/" + id),
  evaluationBoard: (id) => request("GET", "/api/evaluations/" + id + "/board"),
  moveEvalCells: (evaluationId, body) => request("POST", `/api/evaluations/${evaluationId}/cells/stage`, body),
  patchEvalCell: (cellId, body) => request("PATCH", `/api/eval-cells/${cellId}`, body),
  setEvalWarnHours: (evaluationId, warnHours) => request("PUT", `/api/evaluations/${evaluationId}/warn-hours`, { warn_hours: warnHours }),
  evalCellHistory: (cellId) => request("GET", `/api/eval-cells/${cellId}/history`).then((data) => data.items),
  createEvaluation: (body) => request("POST", "/api/evaluations", body),
  pagePreview: (body) => request("POST", "/api/todos/page-preview", body),
  expandPage: (id, override) => request("POST", `/api/todos/${id}/page`, { override }),
  createWithPage: (body) => request("POST", "/api/todos/with-page", body),
  relocatePage: (id, override) => request("POST", `/api/todos/${id}/page/relocate`, { override }),
  pageRules: () => request("GET", "/api/todos/page-rules"),
  savePageRules: (rules, fallback) => request("PUT", "/api/todos/page-rules", { rules, fallback }),
  rulesOverview: (rules, fallback) => request("POST", "/api/todos/page-rules/overview", rules ? { rules, fallback } : {}),
  movePage: (path, data) => request("PATCH", `/api/pages${q(path)}`, data),
  create: (parent, title, type) => request("POST", "/api/pages", { parent, title, type }),
  // RCP management (P6-02)
  recipeSources: () => request("GET", "/api/recipe-sources").then((d) => d.items),
  recipeProfiles: () => request("GET", "/api/recipe-ftp/profiles").then((d) => d.items),
  recipes: (params = {}) => request("GET", "/api/recipes?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null && v !== false))).then((d) => d.items),
  recipeSnapshot: (id) => request("GET", `/api/recipe-snapshots/${id}`),
  reparseRecipeSnapshot: (id) => request("POST", `/api/recipe-snapshots/${id}/reparse`),
  reparseRecipeSource: (id) => request("POST", `/api/recipe-sources/${id}/reparse`),
  recipeMappings: () => request("GET", "/api/recipe-mappings").then((d) => d.items),
  recipeHistory: (id) => request("GET", `/api/recipes/${id}/history`),
  recipeDiff: (id, a, b) => request("GET", `/api/recipes/${id}/diff?a=${a}&b=${b}`),
  recipeCompare: (ids) => request("GET", `/api/recipe-compare?ids=${encodeURIComponent(ids)}`),
  recipeRuns: (sourceId) => request("GET", `/api/recipe-runs?source_id=${sourceId}&limit=6`).then((d) => d.items),
  recipeRun: (id) => request("GET", `/api/recipe-runs/${id}`).then((d) => d.run),
  runRecipeSource: (id) => request("POST", `/api/recipe-sources/${id}/run`).then((d) => d.run),
  cancelRecipeRun: (id) => request("POST", `/api/recipe-runs/${id}/cancel`),
  createRecipeSource: (data) => request("POST", "/api/recipe-sources", data).then((d) => d.source),
  patchRecipeSource: (id, data) => request("PATCH", `/api/recipe-sources/${id}`, data).then((d) => d.source),
  deleteRecipeSource: (id) => request("DELETE", `/api/recipe-sources/${id}`),
  previewRecipeList: (data) => request("POST", "/api/recipe-preview/list", data),
  previewRecipeFilter: (rules, names) => request("POST", "/api/recipe-preview/filter", { rules, names }),
};
