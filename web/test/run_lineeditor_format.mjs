// node web/test/run_lineeditor_format.mjs — exits 1 on any failure. `--plain` reads a JSON array from stdin and prints plainText of each (parity test with app/inline_format.py).
import { runAll } from "./lineeditor_format_cases.js";
import { plainText } from "../js/lineeditor-format.js";

if (process.argv.includes("--plain")) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  console.log(JSON.stringify(JSON.parse(raw).map(plainText)));
} else {
  const res = runAll();
  for (const r of res) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err}`);
  process.exit(res.every((r) => r.ok) ? 0 : 1);
}
