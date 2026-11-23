const MAX_NAME = 120;

function checkedName(value, line) {
  if (!value || value.length > MAX_NAME || /[\x00-\x1f]/.test(value)) {
    throw new Error(line + "행의 이름을 확인해 주세요. 빈 이름은 사용할 수 없고 120자까지 쓸 수 있어요.");
  }
  return value;
}

const lines = (raw) => raw.split(/\r\n?|\n/).map((text, index) => ({
  text: text.replace(/^[ \uFEFF]+|[ \uFEFF]+$/g, ""), line: index + 1,
})).filter(({ text }) => text.trim());

export function parseEquipment(raw) {
  const equipment = [];
  const seen = new Set();
  for (const { text, line } of lines(raw)) {
    const [name, vendor = "", ...extra] = text.split("\t").map((value) => value.trim());
    if (!equipment.length && /^(설비(명)?|equipment)$/i.test(name) && /^(설비사|vendor)$/i.test(vendor) && !extra.length) continue;
    if (extra.length) throw new Error(line + "행은 설비명과 설비사 두 열까지 입력해 주세요.");
    checkedName(name, line);
    if (vendor) checkedName(vendor, line);
    if (seen.has(name)) throw new Error(line + "행의 설비 이름이 중복됐어요.");
    seen.add(name);
    equipment.push({ name, vendor: vendor || null });
  }
  if (equipment.length < 1 || equipment.length > 10) throw new Error("설비는 1~10개를 입력해 주세요.");
  return equipment;
}

export function parseLots(raw) {
  const lots = new Map();
  const records = lines(raw);
  for (const { text, line } of records) {
    const parts = text.includes("\t") ? text.split("\t") : text.match(/^(.+?) {2,}(.+)$/)?.slice(1);
    if (parts?.length !== 2) throw new Error(line + "행은 Lot과 웨이퍼를 탭 또는 공백 두 칸으로 나눠 주세요.");
    const [lot_no, values] = parts.map((value) => value.trim());
    if (line === records[0].line && /^(lot( 번호|_no)?|로트|랏)$/i.test(lot_no) &&
        /^(웨이퍼( 번호)?|wafer(s|_no)?)$/i.test(values)) continue;
    checkedName(lot_no, line);
    if (!lots.has(lot_no)) lots.set(lot_no, new Set());
    const wafers = lots.get(lot_no);
    for (const wafer of values.split(",").map((value) => value.trim())) {
      checkedName(wafer, line);
      if (wafers.has(wafer)) throw new Error(line + "행의 웨이퍼가 같은 Lot에서 중복됐어요.");
      wafers.add(wafer);
    }
    if (wafers.size > 25) throw new Error("Lot당 웨이퍼는 25개까지 입력할 수 있어요.");
  }
  if (lots.size < 1 || lots.size > 20) throw new Error("Lot은 1~20개를 입력해 주세요.");
  return [...lots].map(([lot_no, wafers]) => ({ lot_no, wafers: [...wafers] }));
}
