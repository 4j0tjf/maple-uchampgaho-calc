const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPlan, buildSchedule, remainingWeeks, statText } = require("../plan.js");

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

test("안 씀(0)으로 고정한 능력치는 코인을 쓰지 않는다", () => {
  const plan = buildPlan({
    coins: 100000,
    weeks: 4,
    characters: [{ name: "본캐", weekly: 1, fixed: { ...auto(), allstat: 0, crit: 0 } }],
  });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 0, att: 5, boss: 5, ied: 5, crit: 0 });
  assert.equal(plan.used, 3 * 500 * 4);
  assert.equal(plan.maxed, true);
  assert.equal(plan.next, null);
});

test("코인이 넉넉하면 모든 자동 칸이 5단계로 차고 남는다", () => {
  const plan = buildPlan({ coins: 20000, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.equal(plan.maxed, true);
  assert.equal(plan.used, 10000);
  assert.equal(plan.leftover, 10000);
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
  assert.deepEqual(rows[0].cells[0].groups, [{ count: 1, levels: { allstat: 4, att: 4, boss: 4, ied: 4, crit: 4 }, perUse: 1500 }]);
  assert.deepEqual(rows[1].cells[0].groups, [{ count: 1, levels: { allstat: 4, att: 4, boss: 5, ied: 4, crit: 4 }, perUse: 1700 }]);
  assert.equal(rows.at(-1).cumulative, plan.used);
  assert.equal(rows.at(-1).remaining, 0);
});

test("한 주에 여러 번 쓰면 단계 조합이 같은 사용끼리 묶는다", () => {
  // 주 2회 × 2주 = 4회. 6,000 + 200이면 마지막 1회만 보뎀 5단계
  const plan = buildPlan({ coins: 6200, weeks: 2, characters: [{ name: "본캐", weekly: 2, fixed: auto() }] });
  const rows = buildSchedule(plan);
  assert.deepEqual(rows[0].cells[0].groups.map((g) => [g.count, g.perUse]), [[2, 1500]]);
  assert.deepEqual(rows[1].cells[0].groups.map((g) => [g.count, g.perUse]), [[1, 1500], [1, 1700]]);
  assert.equal(rows[1].uses, 2);
  assert.equal(rows[1].coins, 3200);
});

const day = (w) => `${w.start.month}/${w.start.day}~${w.end.month}/${w.end.day}`;

test("주 수는 오늘이 든 주부터 다음 달 7일(이월 기한)까지 센다", () => {
  // 2026-10-21(수): 이번 주 10/15~10/21 … 10월 코인은 11/7까지 이월되므로 11/5~11/7까지
  const oct = remainingWeeks({ year: 2026, month: 10, day: 21 });
  assert.deepEqual(oct.weeks.map(day), ["10/15~10/21", "10/22~10/28", "10/29~11/4", "11/5~11/7"]);
  assert.deepEqual(oct.weeks.map((w) => [w.current, w.nextMonth]), [[true, false], [false, false], [false, false], [false, true]]);
  assert.deepEqual(oct.deadline, { year: 2026, month: 11, day: 7 });
  assert.equal(oct.carryDeadline, null);
  assert.equal(oct.carryWeeks, 0);
  // 목요일에는 그날부터 새 주
  assert.deepEqual(remainingWeeks({ year: 2026, month: 10, day: 22 }).weeks.map(day), ["10/22~10/28", "10/29~11/4", "11/5~11/7"]);
  // 오늘(2026-11-10, 화): 11/5~11/11 … 11/26~12/2, 12/3~12/7
  assert.deepEqual(remainingWeeks({ year: 2026, month: 11, day: 10 }).weeks.map(day), ["11/5~11/11", "11/12~11/18", "11/19~11/25", "11/26~12/2", "12/3~12/7"]);
  // 이번 주를 빼면 다음 주부터
  assert.deepEqual(remainingWeeks({ year: 2026, month: 10, day: 21 }, false).weeks.map(day), ["10/22~10/28", "10/29~11/4", "11/5~11/7"]);
});

test("해가 바뀌는 12월은 다음 해 1월 7일까지 센다", () => {
  // 2027-01-07은 목요일이라 그날 하루가 마지막 주
  const dec = remainingWeeks({ year: 2026, month: 12, day: 20 });
  assert.deepEqual(dec.weeks.map(day), ["12/17~12/23", "12/24~12/30", "12/31~1/6", "1/7~1/7"]);
  assert.deepEqual(dec.deadline, { year: 2027, month: 1, day: 7 });
});

test("1~7일에는 지난달 이월 코인을 쓸 수 있는 앞쪽 주를 센다", () => {
  // 2026-11-02(월): 이번 주는 10/29에 시작했지만 11월 코인으로는 11/1부터. 10월 이월 코인은 11/7까지라 앞 두 주에서 쓴다
  const nov = remainingWeeks({ year: 2026, month: 11, day: 2 });
  assert.deepEqual(nov.weeks.map(day), ["11/1~11/4", "11/5~11/11", "11/12~11/18", "11/19~11/25", "11/26~12/2", "12/3~12/7"]);
  assert.equal(nov.days, 30);
  assert.deepEqual(nov.carryDeadline, { year: 2026, month: 11, day: 7 });
  assert.deepEqual(nov.weeks.map((w) => w.carryIn), [true, true, false, false, false, false]);
  assert.equal(nov.carryWeeks, 2);
  assert.equal(remainingWeeks({ year: 2026, month: 11, day: 2 }, false).carryWeeks, 1);
  // 1일이 목요일이면 이월 코인은 첫 주에만
  assert.equal(remainingWeeks({ year: 2026, month: 10, day: 1 }).carryWeeks, 1);
  assert.equal(remainingWeeks({ year: 2026, month: 10, day: 1 }).weeks.length, 6);
});

test("이월 코인이 앞 구간에서 다 쓰이면 이번 달 코인과 합쳐 고르게 나눈다", () => {
  // 4회 × 1,500(다섯 칸 4단계) = 6,000 = 이월 1,000 + 이번 달 5,000. 첫 주 1,500에서 이월 1,000이 먼저 빠진다
  const plan = buildPlan({ coins: 5000, carry: 1000, carryWeeks: 1, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.deepEqual(levelsOf(plan.chars[0]), { allstat: 4, att: 4, boss: 4, ied: 4, crit: 4 });
  assert.equal(plan.carryUsed, 1000);
  assert.equal(plan.carryLost, 0);
  assert.equal(plan.leftover, 0);
  const rows = buildSchedule(plan);
  assert.deepEqual(rows.map((r) => [r.coins, r.remaining, r.carryLeft]), [[1500, 4500, 0], [1500, 3000, 0], [1500, 1500, 0], [1500, 0, 0]]);
});

test("이월 코인이 고르게 나눈 몫보다 많으면 기한 안의 주를 더 높은 단계로 쓴다", () => {
  // 이월 2,500은 첫 주에만 쓸 수 있다: 첫 주 1회를 다섯 칸 5단계(2,500)로, 이번 달 3,000은 나머지 3회를 3단계(1,000)로
  const plan = buildPlan({ coins: 3000, carry: 2500, carryWeeks: 1, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  const boss = plan.chars[0].stats.boss;
  assert.equal(boss.level, 3);
  assert.equal(boss.up, 1);
  assert.deepEqual(boss.counts, [0, 0, 0, 3, 0, 1]);
  assert.equal(plan.carryUsed, 2500);
  assert.equal(plan.carryLost, 0);
  assert.equal(plan.leftover, 0);
  assert.equal(plan.used, 5500);
  assert.equal(plan.chars[0].perUse, 1000);
  assert.equal(plan.chars[0].upCoins, 1500);
  const rows = buildSchedule(plan);
  assert.deepEqual(rows.map((r) => r.coins), [2500, 1000, 1000, 1000]);
  assert.deepEqual(rows[0].cells[0].groups[0].levels, { allstat: 5, att: 5, boss: 5, ied: 5, crit: 5 });
  assert.deepEqual(rows.map((r) => r.remaining), [3000, 2000, 1000, 0]);
  assert.deepEqual(plan.next, { charIndex: 0, key: "boss", level: 4, step: 100, missing: 100 });
});

test("이월 코인을 쓸 주가 없거나 다 써도 남으면 사라지는 코인을 알린다", () => {
  const none = buildPlan({ coins: 6000, carry: 800, carryWeeks: 0, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.deepEqual(levelsOf(none.chars[0]), { allstat: 4, att: 4, boss: 4, ied: 4, crit: 4 });
  assert.equal(none.carryUsed, 0);
  assert.equal(none.carryLost, 800);
  assert.deepEqual(buildSchedule(none).map((r) => r.remaining), [4500, 3000, 1500, 0]);
  // 첫 주 1회를 다섯 칸 5단계로 써도 2,500이라 이월 3,000 중 500이 남는다
  const over = buildPlan({ coins: 0, carry: 3000, carryWeeks: 1, weeks: 4, characters: [{ name: "본캐", weekly: 1, fixed: auto() }] });
  assert.equal(over.carryUsed, 2500);
  assert.equal(over.carryLost, 500);
  assert.equal(over.leftover, 0);
  assert.deepEqual(buildSchedule(over).map((r) => r.remaining), [0, 0, 0, 0]);
  assert.deepEqual(buildSchedule(over).map((r) => r.carryExpired), [500, 0, 0, 0]);
  assert.equal(buildSchedule(none)[0].carryExpired, 800);
});

test("고정 단계도 기한 안의 사용분은 이월 코인부터 낸다", () => {
  // 보뎀 5단계 고정 500 × 2회. 첫 주 500은 이월 코인, 둘째 주 500은 이번 달 코인
  const plan = buildPlan({
    coins: 500,
    carry: 500,
    carryWeeks: 1,
    weeks: 2,
    characters: [{ name: "본캐", weekly: 1, fixed: { allstat: 0, att: 0, boss: 5, ied: 0, crit: 0 } }],
  });
  assert.equal(plan.fixedCoins, 1000);
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.carryUsed, 500);
  assert.equal(plan.leftover, 0);
});

test("능력치 표기", () => {
  assert.equal(statText("allstat", 4), "+40");
  assert.equal(statText("boss", 5), "+10%");
  assert.equal(statText("crit", 5), "+2.5%");
  assert.equal(statText("crit", 1), "+0.5%");
});
