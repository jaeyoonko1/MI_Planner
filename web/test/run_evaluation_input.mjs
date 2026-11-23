import assert from "node:assert/strict";
import { parseEquipment, parseLots } from "../js/evaluation-input.js";

assert.deepEqual(parseEquipment("설비명\t설비사\r\nEQ-A01\r\nEQ-A02\tTEST VENDOR"), [
  { name: "EQ-A01", vendor: null }, { name: "EQ-A02", vendor: "TEST VENDOR" },
]);
assert.deepEqual(parseLots("Lot\tWafer\nLOT-TEST-001\t001\nLOT-TEST-001\t02\nLOT-TEST-002  1, 3"), [
  { lot_no: "LOT-TEST-001", wafers: ["001", "02"] }, { lot_no: "LOT-TEST-002", wafers: ["1", "3"] },
]);
assert.throws(() => parseEquipment("\tTEST-VENDOR"), /1행/);
assert.throws(() => parseEquipment("EQ-A01\nEQ-A01"), /중복/);
assert.throws(() => parseLots("LOT-TEST-001\t1,1"), /중복/);
assert.throws(() => parseLots("LOT-TEST-001\t1,"), /1행/);
assert.throws(() => parseLots("LOT-TEST-001 1"), /두 칸/);
console.log("PASS evaluation clipboard input");
