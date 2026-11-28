/** Extract Excel range metadata as data. The caller must validate any future rendering or formula evaluation separately. */

export const isExcelDimension = (value) => typeof value === "string" && value.length <= 256
  && /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)?$/i.test(value);
const dimension = (value) => isExcelDimension(value) ? value : undefined;
const color = /^(?:#[\da-f]{3}(?:[\da-f]{3})?|[a-z]+|rgba?\([\d., %/]+\))$/i;
const fontFamily = /^(?:[\p{L}\p{M}\d _-]+|"[^"<>&\\]+"|'[^'<>&\\]+')(?:\s*,\s*(?:[\p{L}\p{M}\d _-]+|"[^"<>&\\]+"|'[^'<>&\\]+'))*$/u;
const border = /^(?:none|(?:[\d.]+(?:px|pt)|0|thin|medium|thick)\s+(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)(?:\s+(?:#[\da-f]{3,6}|[a-z]+|rgba?\([\d., %/]+\)))?)$/i;
const cellProperties = {
  "font-family": fontFamily,
  "font-size": /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)$/i,
  "font-weight": /^(?:normal|bold|[1-9]00)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "text-decoration": /^(?:(?:none|underline|line-through|overline|double)\s*)+$/i,
  "text-decoration-line": /^(?:(?:none|underline|line-through|overline)\s*)+$/i,
  "text-decoration-style": /^(?:solid|double|dotted|dashed|wavy)$/i,
  "text-underline-style": /^(?:single|double)$/i,
  color,
  "background-color": color,
  border,
  "border-top": border,
  "border-right": border,
  "border-bottom": border,
  "border-left": border,
  "text-align": /^(?:general|start|end|left|right|center|justify)$/i,
  "vertical-align": /^(?:top|middle|center|bottom|baseline|justify)$/i,
  "white-space": /^(?:normal|nowrap|pre|pre-wrap|pre-line)$/i,
  "text-indent": /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|%)$/i,
  "padding-left": /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)$/i,
  "padding-right": /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)$/i,
  "writing-mode": /^(?:horizontal-tb|vertical-rl|vertical-lr|tb-rl|tb-lr|lr-tb)$/i,
  "mso-rotate": /^-?\d{1,3}$/,
  "mso-text-control": /^shrinktofit$/i,
  "layout-flow": /^vertical-ideographic$/i,
};

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const isExcelNumber = (value) => typeof value === "string" && numeric.test(value) && Number.isFinite(Number(value));
export const isExcelStyle = (name, value) => Object.hasOwn(cellProperties, name)
  && typeof value === "string" && value.length <= 256 && cellProperties[name].test(value);
const fillPatterns = new Set([
  "gray-0625", "gray-125", "gray-25", "gray-50", "gray-75",
  "horz-stripe", "vert-stripe", "diag-stripe", "reverse-diag-stripe", "diag-cross", "thick-diag-cross",
  "thin-horz-stripe", "thin-vert-stripe", "thin-diag-stripe", "thin-reverse-diag-stripe",
  "thin-horz-cross", "thin-diag-cross",
]);

export const isExcelFillPattern = (pattern, foreground) => fillPatterns.has(pattern)
  && typeof foreground === "string" && foreground.length <= 256 && color.test(foreground);

function excelFillPattern(declaration) {
  if (!declaration || declaration.length > 256) return undefined;
  const match = /^(.+?)\s+([a-z][\da-z-]*)$/i.exec(declaration);
  if (!match) return undefined;
  const [, foreground, name] = match;
  const pattern = name.toLowerCase();
  return isExcelFillPattern(pattern, foreground) ? { pattern, foreground } : undefined;
}

const textProperties = [
  "font-family", "font-size", "font-weight", "font-style", "color", "background-color",
  "text-decoration-style",
];
const decorationTags = {
  u: "underline", ins: "underline", s: "line-through", strike: "line-through", del: "line-through",
};

export function excelTextStyles({ tag, attrs }, css, inherited = {}) {
  const styles = { ...inherited };
  const candidates = {
    "font-family": tag === "font" ? attrs.face : undefined,
    color: tag === "font" ? attrs.color : undefined,
    "font-weight": tag === "b" || tag === "strong" ? "bold" : undefined,
    "font-style": tag === "i" || tag === "em" ? "italic" : undefined,
    ...css,
  };
  for (const name of textProperties) {
    const value = candidates[name];
    if (isExcelStyle(name, value)) styles[name] = value;
  }
  const declared = css["text-decoration-line"] ?? css["text-decoration"];
  const decoration = declared?.length <= 128 && cellProperties["text-decoration-line"].test(declared)
    ? declared.toLowerCase().trim()
    : inherited["text-decoration-line"];
  const lines = new Set(decoration && decoration !== "none" ? decoration.split(/\s+/) : []);
  if (declared && decoration === "none") delete styles["text-decoration-style"];
  const tagLine = Object.hasOwn(decorationTags, tag) ? decorationTags[tag] : undefined;
  if (tagLine) lines.add(tagLine);
  if (decoration || tagLine) styles["text-decoration-line"] = [...lines].join(" ") || "none";
  const underlineStyle = css["text-underline-style"] ?? "";
  if (lines.has("underline") && cellProperties["text-underline-style"].test(underlineStyle)) {
    styles["text-underline-style"] = underlineStyle.toLowerCase();
  } else if (!lines.has("underline")) {
    delete styles["text-underline-style"];
  }
  return styles;
}

export function sameExcelTextStyles(left, right) {
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every((name) => left[name] === right[name]);
}

export function excelCellMetadata(attrs, css, displayText, rowSpan, colSpan) {
  const styles = {};
  // Excel emits align on individual cells when the shared CSS uses its General alignment.
  const cssAlignment = css["text-align"];
  const htmlAlignment = attrs.align?.trim().toLowerCase();
  const hasExcelAlignment = (!cssAlignment || /^general$/i.test(cssAlignment)) &&
    /^(?:left|center|right|justify)$/.test(htmlAlignment ?? "");
  const candidates = {
    ...css,
    "text-align": hasExcelAlignment ? htmlAlignment : cssAlignment,
    "background-color": css["background-color"] ?? css.background ?? attrs.bgcolor,
    "vertical-align": css["vertical-align"] ?? attrs.valign,
  };
  for (const name of Object.keys(cellProperties)) {
    const value = candidates[name];
    if (isExcelStyle(name, value)) styles[name] = value;
  }

  // An empty x:num marks a number but does not supply a locale-independent raw value.
  const rawNumber = attrs["x:num"];
  const rawText = attrs["x:str"];
  let value = null;
  if (rawText !== undefined) {
    value = { type: "text", raw: rawText || displayText };
  } else if (isExcelNumber(rawNumber)) {
    value = { type: "number", raw: rawNumber };
  }

  const fillPattern = excelFillPattern(css["mso-pattern"]);
  return {
    displayText, value, styles, rowSpan, colSpan,
    ...(fillPattern ? { fillPattern } : {}),
    numberFormat: css["mso-number-format"] ?? null,
    width: dimension(css.width ?? attrs.width),
    height: dimension(css.height ?? attrs.height),
  };
}

export function excelNumberSeparators(css) {
  const decimal = css["mso-displayed-decimal-separator"];
  const thousands = css["mso-displayed-thousand-separator"];
  // Keep the Office declarations, including CSS escaping, independently of raw cell values.
  return {
    decimal: decimal && decimal.length <= 32 ? decimal : null,
    thousands: thousands && thousands.length <= 32 ? thousands : null,
  };
}

export function excelColumnLayout(table, columnCount, styleOf, spanOf) {
  const columns = [];
  for (const child of table.children) {
    const definitions = child.tag === "colgroup" ? child.children.filter((node) => node.tag === "col") : [child];
    for (const column of definitions) {
      if (column.tag !== "col") continue;
      const css = styleOf(column);
      const width = dimension(css.width ?? column.attrs.width) ?? null;
      const hidden = /^none$/i.test(css.display ?? "");
      for (let count = 0, span = spanOf(column.attrs.span); count < span && columns.length < columnCount; count++) {
        columns.push({ width, hidden });
      }
    }
    if (columns.length === columnCount) break;
  }
  return columns;
}

export function excelRowHeights(rows, styleOf) {
  return rows.map((row) => dimension(styleOf(row).height ?? row.attrs.height) ?? null);
}
