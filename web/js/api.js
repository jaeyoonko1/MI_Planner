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
  create: (parent, title, type) => request("POST", "/api/pages", { parent, title, type }),
};
