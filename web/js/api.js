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
  create: (parent, title, type) => request("POST", "/api/pages", { parent, title, type }),
};
