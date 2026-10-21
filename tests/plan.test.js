const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPlan, buildSchedule, monthInfo, WEIGHT_PRESETS, statText } = require("../plan.js");

const auto = () => ({ allstat: null, att: null, boss: null, ied: null, crit: null });
const levelsOf = (char) => Object.fromEntries(Object.entries(char.stats).map(([key, s]) => [key, s.up ? `${s.level}+${s.up}` : s.level]));

test("코인이 딱 맞으면 다섯 능력치를 같은 단계로 채운다", () => {
  // 4회 × 다섯 칸 × 4단계 300 = 6,000
  const plan = buildPlan({ coins: 6000, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 4, att: 4, boss: 4, ied: 4, crit: 4 });
  assert.equal(plan.used, 6000);
  assert.equal(plan.leftover, 0);
  assert.equal(plan.chars[0].perUse, 1500);
});

test("남는 코인은 보뎀부터 사용 1회 단위로 한 단계 올린다", () => {
  // 6,000 + 600: 4→5단계는 1회 200코인이므로 보뎀 3회만 5단계
  const plan = buildPlan({ coins: 6600, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 4, att: 4, boss: "4+3", ied: 4, crit: 4 });
  assert.equal(plan.leftover, 0);
  assert.deepEqual(plan.next, { charIndex: 0, key: "boss", level: 5, step: 200, missing: 200 });
});

test("고정 단계를 먼저 빼고 나머지를 자동 칸에 나눈다", () => {
  // 보뎀 5단계 고정 500 × 4회 = 2,000. 남은 4,000을 네 칸 × 4회에: 3단계(800/회) 3,200 + 4단계 8칸·회 800
  const plan = buildPlan({ coins: 6000, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: { ...auto(), boss: 5 } }] });
  assert.equal(plan.fixedCoins, 2000);
  assert.equal(plan.autoBudget, 4000);
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 3, att: 4, boss: 5, ied: 4, crit: 3 });
  assert.equal(plan.leftover, 0);
});

test("고정 단계가 월 코인을 넘으면 모자란 코인을 알린다", () => {
  const all5 = { allstat: 5, att: 5, boss: 5, ied: 5, crit: 5 };
  const plan = buildPlan({ coins: 6000, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: all5 }] });
  assert.equal(plan.fixedCoins, 10000);
  assert.equal(plan.shortfall, 4000);
  assert.equal(plan.leftover, -4000);
  assert.equal(plan.autoSlots, 0);
});

test("안 씀(0) 고정과 가치 0인 능력치는 코인을 쓰지 않는다", () => {
  const plan = buildPlan({
    coins: 100000,
    weeks: 4,
    weights: { ...WEIGHT_PRESETS.even.weights, crit: 0 },
    characters: [{ name: "본캐", weekly: 1, fixed: { ...auto(), allstat: 0 } }],
  });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 0, att: 5, boss: 5, ied: 5, crit: 0 });
  assert.equal(plan.used, 3 * 500 * 4);
  assert.equal(plan.maxed, true); // 크뎀은 가치 0이라 자동 칸에서 빠지고, 나머지는 모두 찼다
  assert.equal(plan.next, null);
});

test("코인이 넉넉하면 모든 자동 칸이 5단계로 차고 남는다", () => {
  const plan = buildPlan({ coins: 20000, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.equal(plan.maxed, true);
  assert.equal(plan.used, 10000);
  assert.equal(plan.leftover, 10000);
});

test("보스 딜 추정은 올스탯을 올리기 전에 보뎀·방무를 5단계까지 올린다", () => {
  // 보뎀·방무 1~4단계 2,400 → 공/마·크뎀 1~3단계 1,600 → 보뎀·방무 5단계 1,600
  const plan = buildPlan({
    coins: 5600,
    weeks: 4,
    weights: WEIGHT_PRESETS.boss.weights,
    characters: [{ name: "본캐", weekly: 1, fixed: auto() }],
  });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 0, att: 3, boss: 5, ied: 5, crit: 3 });
  assert.equal(plan.leftover, 0);
});

test("여러 캐릭터는 사용 횟수만큼 코인을 나눠 쓴다", () => {
  const plan = buildPlan({
    coins: 15000,
    weeks: 5,
    characters: [
      { name: "본캐", weekly: 2, fixed: auto() },
      { name: "부캐", weekly: 1, fixed: auto() },
      { name: "쉬는 캐릭터", weekly: 0, fixed: auto() },
    ],
  });
  assert.equal(plan.totalUses, 15);
  assert.equal(plan.chars[2].monthly, 0);
  // 15회 × 1,000(다섯 칸 3단계) = 15,000
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 3, att: 3, boss: 3, ied: 3, crit: 3 });
  assert.deepEqual(levelsOf(plan.chars[1]), { allstat: 3, att: 3, boss: 3, ied: 3, crit: 3 });
  assert.equal(plan.leftover, 0);
});

test("주차별 계획은 한 단계 위 사용을 달 끝에 두고, 합계가 월 사용 코인과 같다", () => {
  const plan = buildPlan({ coins: 6600, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  const rows = buildSchedule(plan);
  assert.deepEqual(rows.map((r) => r.coins), [1500, 1700, 1700, 1700]);
  assert.deepEqual(rows[1].cells[0].ups, [{ key: "boss", level: 5, count: 1 }]);
  assert.equal(rows.at(-1).cumulative, plan.used);
  assert.equal(rows.at(-1).remaining, 0);
});

test("주 수는 그 달의 목요일(주간 초기화) 수다", () => {
  const oct = monthInfo(2026, 10);
  assert.equal(oct.days, 31);
  assert.deepEqual(oct.weeks.map((w) => w.start), [1, 8, 15, 22, 29]);
  assert.deepEqual(oct.weeks.at(-1), { start: 29, end: 31 });
  assert.equal(monthInfo(2026, 11).weeks.length, 4);
  assert.equal(monthInfo(2027, 2).days, 28);
});

test("능력치 표기", () => {
  assert.equal(statText("allstat", 4), "+40");
  assert.equal(statText("boss", 5), "+10%");
  assert.equal(statText("crit", 5), "+2.5%");
  assert.equal(statText("crit", 1), "+0.5%");
});
