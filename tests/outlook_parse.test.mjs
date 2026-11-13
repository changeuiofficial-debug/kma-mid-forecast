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


// 2026-11-13 06시 발표 실제 전망문(강수 문장에 절이 둘, 해상 문장에 조사 '은').
const TODAY = [
  "○ (강수) 17일(화) 오후~18일(수) 오전 전국에 비가 내리겠고, 18일(수) 오후 충남권과 전라권, 제주도에 비가 내리겠습니다.",
  "○ (기온) 17일(화) 아침 기온은 7~13℃, 낮 기온은 13~18℃로 평년(최저기온 -2~7℃, 최고기온 9~16℃)보다 높겠으나,",
  "              18일(수)~23일(월) 아침 기온은 -2~13℃, 낮 기온은 6~15℃로 평년과 비슷하거나 조금 낮겠습니다.",
  "○ (해상) 18일(수)~19일(목)은 전 해상, 20일(금)은 동해상에 물결이 1.0~4.0m로 매우 높게 일겠습니다.",
  "* (기온) 18일(수)~19일(목)은 북쪽에서 유입되는 찬 공기의 영향으로 기온이 큰 폭으로 떨어지겠고, 바람도 강하게 불어 체감온도는 더욱 낮아지겠으니, 급격한 기온변화로 인한 건강관리에 각별히 유의하기 바랍니다.",
  "* (변동성) 17일(화)~18일(수)은 기압골의 발달과 위치, 이동속도 등 우리나라 주변 기압계 변화에 따라 강수시점과 구역, 강수형태(비/눈)가 변경될 가능성이 있으니, 앞으로 발표하는 최신 예보를 참고하기 바랍니다.",
].join("\n");
const dateCount = (t) => (t.match(new RegExp(P.DEXPR, "g")) || []).length;
const rowDates = (rows) => rows.reduce((n, r) => n + (r.segs ? r.segs.length : 0) + (r.type === "temp" && r.date ? 1 : 0), 0);

test("절이 둘인 강수 문장은 두 번째 절(충남권·전라권·제주도)을 빠뜨리지 않는다", () => {
  const rain = P.analyze(TODAY, "202611130600").find(x => x.topic === "강수");
  const rows = rain.paragraphs[0].rows;
  assert.equal(rain.complete, true);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].segs, [{ date: "11/17(화) 오후 ~ 11/18(수) 오전", place: "전국" }]);
  assert.deepEqual(rows[1].segs, [{ date: "11/18(수) 오후", place: "충남권과 전라권, 제주도" }]);
});

test("해상: 날짜 뒤 조사 '은'이 지역 이름에 붙지 않는다", () => {
  const sea = P.analyze(TODAY, "202611130600").find(x => x.topic === "해상").paragraphs[0].rows[0];
  assert.deepEqual(sea.segs, [{ date: "11/18(수) ~ 11/19(목)", place: "전 해상" }, { date: "11/20(금)", place: "동해상" }]);
  assert.equal(sea.low + "~" + sea.high, "1.0~4.0");
});

test("요약 완료로 표시된 문단은 원문의 날짜를 하나도 빠뜨리지 않는다(실제 전망문 3건)", () => {
  const texts = [[TODAY, "202611130600"], [real["outlook|202611101800"].rawItem.wfSv, "202611101800"], [real["outlook|202611100600"].rawItem.wfSv, "202611100600"]];
  let checked = 0;
  for (const [text, tm] of texts) for (const topic of P.analyze(text, tm)) for (const par of topic.paragraphs) {
    if (!par.complete) continue;
    assert.equal(rowDates(par.rows), dateCount(par.text), `날짜 누락: ${par.text}`);
    checked++;
  }
  assert.ok(checked >= 6, `검사한 문단 수 ${checked}`);
});

test("'흐리겠고, …오후부터 …사이 전국에 비가 내리겠습니다' 같은 문장은 지역으로 오인하지 않는다", () => {
  const w = P.analyze(real["outlook|202611100600"].rawItem.wfSv, "202611100600").find(x => x.topic === "주말전망");
  assert.equal(w.complete, false);
  assert.ok(!w.paragraphs.flatMap(p => p.rows).some(r => r.type === "rain"));
});

console.log(`\n${passed} passed`);
