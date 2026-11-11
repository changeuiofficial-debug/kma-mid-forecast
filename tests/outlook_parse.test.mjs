// static/outlook-parse.js 단독 테스트 (node tests/outlook_parse.test.mjs)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(join(here, "..", "static", "outlook-parse.js"));
const real = JSON.parse(readFileSync(join(here, "fixtures", "real_20261110.json"), "utf8"));

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

// 오늘(2026-11-11 06시) 실제 전망문 중 해상 문장은 fixture에 없어 원문 그대로 옮겨 사용한다.
const SEA = "18일(수) 전 해상, 19일(목) 동해상에 물결이 1.0~4.0m로 매우 높게 일겠습니다.";

test("실제 전망문: 뽑은 숫자·지역은 모두 원문에 그대로 있다", () => {
  for (const key of ["outlook|202611101800", "outlook|202611100600"]) {
    const tm = key.split("|")[1], text = real[key].rawItem.wfSv;
    for (const topic of P.analyze(text, tm)) for (const par of topic.paragraphs) for (const row of par.rows) {
      const nums = [];
      if (row.type === "temp") nums.push(...row.am, ...row.day);
      if (row.type === "sea") nums.push(row.low, row.high);
      for (const n of nums) assert.ok(par.text.includes(n), `${n} not in source: ${par.text}`);
      for (const seg of row.segs || []) if (seg.place) assert.ok(par.text.includes(seg.place), seg.place);
    }
  }
});

test("강수 문장은 날짜·지역 칩으로 나뉘고 완전하다", () => {
  const t = real["outlook|202611101800"].rawItem.wfSv, a = P.analyze(t, "202611101800");
  const rain = a.find(s => s.topic === "강수");
  assert.equal(rain.complete, true);
  const row = rain.paragraphs[0].rows[0];
  assert.equal(row.kind, "비");
  assert.deepEqual(row.segs.map(s => s.place), ["전국", "강원영동", "제주도"]);
  assert.equal(row.segs[0].date, "11/15(일) 오전");
});

test("기온: 날짜 범위에 '아침'이 섞이지 않고 평년 비교가 붙는다", () => {
  const a = P.analyze(real["outlook|202611101800"].rawItem.wfSv, "202611101800");
  const rows = a.filter(s => s.topic === "기온").flatMap(s => s.paragraphs.flatMap(p => p.rows));
  assert.equal(rows[0].date, "11/15(일) ~ 11/17(화)");
  assert.deepEqual(rows[0].am, ["6", "14"]);
  assert.deepEqual(rows[0].day, ["12", "19"]);
  assert.equal(rows[0].trend, "평년과 비슷하거나 조금 높음");
  assert.deepEqual(rows[1].am, ["-3", "10"]);   // 음수 보존
  assert.equal(rows[1].trend, "평년과 비슷하거나 조금 낮음");
});

test("주말전망·변동성처럼 문장이 복잡하면 완전하지 않다고 표시(원문 펼침)", () => {
  const a = P.analyze(real["outlook|202611101800"].rawItem.wfSv, "202611101800");
  assert.equal(a.find(s => s.topic === "주말전망").complete, false);
  assert.equal(a.find(s => s.topic === "변동성").complete, false);
});

test("해상 문장: 지역·파고 범위·수식어", () => {
  const [sea] = P.analyze("○ (해상) " + SEA, "202611110600");
  const row = sea.paragraphs[0].rows[0];
  assert.equal(row.type, "sea");
  assert.deepEqual(row.segs, [{ date: "11/18(수)", place: "전 해상" }, { date: "11/19(목)", place: "동해상" }]);
  assert.equal(row.low, "1.0"); assert.equal(row.high, "4.0");
  assert.equal(row.qualifier, "매우 높게");
});

test("월 변환: 일과 요일이 모두 맞아야 하고, 월이 바뀌어도 맞는다", () => {
  assert.equal(P.resolveDay(15, "일", "202611101800"), "11/15(일)");
  assert.equal(P.resolveDay(2, "수", "202611281800"), "12/2(수)");     // 11월 말 발표 → 12월
  assert.equal(P.resolveDay(15, "월", "202611101800"), "15(월)");      // 요일이 안 맞으면 월을 짐작하지 않는다
});

test("해석할 수 없는 문장은 칩을 만들지 않는다", () => {
  const [x] = P.analyze("○ (기타) 이번 주는 대체로 맑겠습니다.", "202611101800");
  assert.deepEqual(x.paragraphs[0].rows, []);
  assert.equal(x.complete, false);
});

test("비슷한 표현이어도 숫자가 하나라도 없으면 기온 칩을 만들지 않는다", () => {
  const [x] = P.analyze("○ (기온) 15일(일) 아침 기온은 6~14℃로 평년과 비슷하겠습니다.", "202611101800");
  assert.ok(!x.paragraphs[0].rows.some(r => r.type === "temp"));
});

console.log(`\n${passed} passed`);
