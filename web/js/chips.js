// Toggle-chip group (replaces dropdowns, D-12). Single-select.
export function chipGroup(options, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  wrap.setAttribute("role", "group");
  let current = value;
  const buttons = options.map(({ value: v, label }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.dataset.value = v;
    b.addEventListener("click", () => {
      current = v;
      paint();
      onChange?.(v);
    });
    wrap.append(b);
    return b;
  });
  function paint() {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === current)));
  }
  paint();
  wrap.getValue = () => current;
  return wrap;
}
