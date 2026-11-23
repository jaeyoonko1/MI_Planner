// node web/test/run_lineeditor.mjs — exits 1 on any failure.
import { runAll } from "./lineeditor_cases.js";
const res = runAll();
for (const r of res) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.err}`);
process.exit(res.every((r) => r.ok) ? 0 : 1);
