/**
 * 챔피언의 가호 월간 코인 배분 계산. 화면(app.js)과 테스트(tests/plan.test.js)가 함께 쓴다.
 *
 * 수치 출처: 메이플스토리 공식 가이드 「유니온 챔피언」, 나무위키 「유니온 챔피언」 (2026-10 확인).
 * 패치로 코인이나 능력치, 이월 기간이 바뀌면 LEVEL_COST, STATS, CARRY_DAYS만 고친다.
 *
 * 코인 이월: 매월 1일 0시에 초기화될 때 남은 코인은 7일간 남고 먼저 쓰인다(공식 가이드). CARRY_DAYS.
 *
 * 브라우저에서는 일반 <script>로 읽어 window.GahoPlan에 붙는다(file://로 열어도 동작하도록 모듈을 쓰지 않는다).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GahoPlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** 단계별 1회 사용 코인(능력치 하나). 0단계는 쓰지 않음. 추가 경험치는 3배지만 이 계산기에서는 다루지 않는다. */
  const LEVEL_COST = [0, 50, 125, 200, 300, 500];
  const MAX_LEVEL = 5;
  /**
   * 코인은 매월 1일 0시에 초기화되지만, 남은 코인은 이월되어 초기화 후 7일간(다음 달 7일 23:59:59까지) 남고
   * 코인을 쓸 때 이월 코인부터 먼저 빠진다. 그래서 이번 달 코인은 다음 달 7일까지 나눠 쓴다.
   */
  const CARRY_DAYS = 7;

  /** 게임 UI 순서. per는 1단계당 증가량. */
  const STATS = [
    { key: "allstat", label: "올스탯", short: "올스탯", per: 10, unit: "" },
    { key: "att", label: "공격력/마력", short: "공/마", per: 5, unit: "" },
    { key: "boss", label: "보스 몬스터 데미지", short: "보뎀", per: 2, unit: "%" },
    { key: "ied", label: "방어율 무시", short: "방무", per: 2, unit: "%" },
    { key: "crit", label: "크리티컬 데미지", short: "크뎀", per: 0.5, unit: "%" },
  ];
  const STAT_KEYS = STATS.map((s) => s.key);

  /** 같은 단계를 두고 코인이 모자라면 앞쪽 능력치부터 올린다. */
  const TIE_ORDER = ["boss", "ied", "att", "crit", "allstat"];

  const toInt = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const clampLevel = (value) => Math.min(MAX_LEVEL, toInt(value));
  const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
  /** level → level+1로 올릴 때 더 드는 코인. */
  const stepCost = (level) => LEVEL_COST[level + 1] - LEVEL_COST[level];

  /** "+40", "+8%", "+2.5%". */
  function statText(key, level) {
    const stat = STATS.find((s) => s.key === key);
    const value = Math.round(stat.per * level * 10) / 10;
    return `+${value.toLocaleString("ko-KR")}${stat.unit}`;
  }

  /** reach[l] = l단계 이상으로 쓰는 횟수(reach[0]은 사용 횟수) → counts[l] = 꼭 l단계로 쓰는 횟수. */
  const countsOf = (reach) => reach.map((n, level) => n - (level < MAX_LEVEL ? reach[level + 1] : 0));

  /**
   * @param {{coins:number, weeks:number, carry?:number, carryWeeks?:number,
   *          characters:{id?:string, name:string, weekly:number, fixed?:Record<string, number|null>}[]}} input
   *   fixed[key]가 null/undefined면 자동, 0~5면 그 단계로 매번 고정(0은 안 씀).
   *   carry는 지난달에서 이월된 코인, carryWeeks는 그 코인을 쓸 수 있는 앞쪽 주 수(이달 7일까지 걸친 주).
   *
   * 자동 칸 = 캐릭터 × 능력치. 칸마다 "사용 1회를 l-1단계에서 l단계로 올리는" 일을 모아 두고,
   * 올리는 코인이 싼 것부터(1단계 50 → 2·3단계 75 → 4단계 100 → 5단계 200) 남은 코인이 허락하는 만큼 채운다.
   * 그래서 다섯 능력치가 같은 단계로 고르게 오르고, 남는 코인은 다음 칸 하나를 올리는 코인보다 적다.
   * 사용 1회 단위로 채우므로 칸 하나는 "기본 단계 + 이번 달 n회만 한 단계 위"가 될 수 있다.
   *
   * 이월 코인이 있으면 사용을 앞 구간(이월 코인 기한 안의 주)과 뒤 구간으로 나눈다. 앞 구간은 이월 코인부터,
   * 모자라면 이번 달 코인으로 낸다. 뒤 구간은 이번 달 코인으로만 낸다. 이월 코인이 앞 구간을 고르게 채우고도 남으면
   * 앞 구간만 더 높은 단계로 올려서 기한 안에 다 쓴다(이번 달 코인은 뒤 구간에 남긴다).
   */
  function buildPlan(input) {
    const coins = toInt(input.coins);
    const weeks = toInt(input.weeks);
    const carry = toInt(input.carry);
    const carryWeeks = carry ? Math.min(weeks, toInt(input.carryWeeks)) : 0;

    const chars = (input.characters || []).map((c) => {
      const weekly = toInt(c.weekly);
      const uses = weekly * weeks;
      const early = weekly * carryWeeks;
      const stats = {};
      let fixedPerUse = 0;
      for (const key of STAT_KEYS) {
        const fixed = c.fixed ? c.fixed[key] : null;
        if (fixed == null) {
          // 구간별(앞, 뒤) reach
          stats[key] = { mode: "auto", level: 0, up: 0, reach: [[early, 0, 0, 0, 0, 0], [uses - early, 0, 0, 0, 0, 0]] };
        } else {
          const level = clampLevel(fixed);
          stats[key] = { mode: "fixed", level, up: 0 };
          fixedPerUse += LEVEL_COST[level];
        }
      }
      return { id: c.id, name: c.name, weekly, uses, early, stats, fixedPerUse, perUse: 0, upCoins: 0, monthly: 0 };
    });

    // 고정 단계: 앞 구간 사용분은 이월 코인부터 낸다.
    const fixedCoins = sum(chars, (c) => c.uses * c.fixedPerUse);
    let carryLeft = carry - Math.min(carry, sum(chars, (c) => c.early * c.fixedPerUse));
    let coinsLeft = coins - (fixedCoins - (carry - carryLeft));
    const shortfall = Math.max(0, -coinsLeft);
    coinsLeft = Math.max(0, coinsLeft);
    const autoBudget = coinsLeft + carryLeft;

    const blocks = [];
    let autoSlots = 0;
    chars.forEach((c, charIndex) => {
      if (!c.uses) return;
      for (const key of STAT_KEYS) {
        if (c.stats[key].mode !== "auto") continue;
        autoSlots++;
        for (const seg of [0, 1]) {
          if (!c.stats[key].reach[seg][0]) continue;
          for (let level = 1; level <= MAX_LEVEL; level++) blocks.push({ charIndex, key, seg, level, step: stepCost(level - 1) });
        }
      }
    });
    // 같은 칸 같은 단계는 뒤 구간부터: 이번 달 코인으로 올리는 n회는 코인이 쌓인 뒤쪽에 둔다.
    blocks.sort((a, b) =>
      a.step - b.step ||
      a.level - b.level ||
      TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key) ||
      a.charIndex - b.charIndex ||
      b.seg - a.seg);

    let next = null;
    for (const block of blocks) {
      const reach = chars[block.charIndex].stats[block.key].reach[block.seg];
      const available = reach[block.level - 1];
      const budget = block.seg === 0 ? carryLeft + coinsLeft : coinsLeft;
      const filled = Math.min(available, Math.floor(budget / block.step));
      reach[block.level] = filled;
      let cost = filled * block.step;
      if (block.seg === 0) {
        const fromCarry = Math.min(carryLeft, cost);
        carryLeft -= fromCarry;
        cost -= fromCarry;
      }
      coinsLeft -= cost;
      if (filled < available && !next) next = block;
    }

    for (const c of chars) {
      for (const key of STAT_KEYS) {
        const stat = c.stats[key];
        if (stat.mode === "auto") {
          const total = stat.reach[0].map((n, level) => n + stat.reach[1][level]);
          stat.counts = countsOf(total);
          stat.level = c.uses ? stat.counts.findIndex((n) => n > 0) : 0;
        } else {
          stat.counts = LEVEL_COST.map((_, level) => (level === stat.level ? c.uses : 0));
        }
        // 기본 단계보다 위로 쓰는 횟수
        stat.up = c.uses - stat.counts[stat.level];
        c.perUse += LEVEL_COST[stat.level];
        stat.counts.forEach((n, level) => (c.monthly += n * LEVEL_COST[level]));
      }
      c.upCoins = c.monthly - c.uses * c.perUse;
    }

    const used = sum(chars, (c) => c.monthly);
    const carryUsed = carry - carryLeft;
    return {
      coins,
      carry,
      carryWeeks,
      weeks,
      chars,
      totalUses: sum(chars, (c) => c.uses),
      fixedCoins,
      autoBudget,
      autoCoins: used - fixedCoins,
      used,
      /** 지난달 이월 코인 중 쓰는 코인과, 기한 안에 다 못 써서 사라지는 코인. */
      carryUsed,
      carryLost: carryLeft,
      /** 이번 달 코인 중 남는 코인. 음수면 고정 단계만으로 코인을 넘는다. */
      leftover: coins - (used - carryUsed),
      shortfall,
      autoSlots,
      /** 자동 칸이 있고 모두 5단계까지 찼는지. */
      maxed: blocks.length > 0 && !next,
      /** 코인이 모자라 다 채우지 못한 첫 칸. missing은 그 칸 1회를 더 올리는 데 모자란 코인. */
      next: next && {
        charIndex: next.charIndex,
        key: next.key,
        level: next.level,
        step: next.step,
        missing: next.step - (next.seg === 0 ? carryLeft + coinsLeft : coinsLeft),
      },
    };
  }

  /**
   * 캐릭터의 index번째(0부터, 달 안의 순서) 사용에서 능력치별 단계.
   * 구간(이월 코인 기한 안 / 그 뒤)마다 높은 단계로 쓰는 회차를 그 구간의 마지막 사용들에 둔다.
   * 이월 코인이 없으면 구간이 하나라 한 단계 위로 쓰는 n회는 달의 마지막 사용들이 된다.
   */
  function useLevels(char, index) {
    const seg = index < char.early ? 0 : 1;
    const pos = seg ? index - char.early : index;
    const levels = {};
    for (const key of STAT_KEYS) {
      const stat = char.stats[key];
      if (stat.mode !== "auto") {
        levels[key] = stat.level;
        continue;
      }
      const reach = stat.reach[seg];
      let level = 0;
      while (level < MAX_LEVEL && pos >= reach[0] - reach[level + 1]) level++;
      levels[key] = level;
    }
    return levels;
  }

  const levelsCost = (levels) => sum(STAT_KEYS, (key) => LEVEL_COST[levels[key]]);

  /**
   * 주차별 사용 계획. 주마다 캐릭터별로 같은 단계 조합끼리 묶는다.
   * remaining은 그 주까지 쓰고 남은 코인. 지난달 이월 코인은 앞 구간에서 먼저 빠지고, 기한이 지나면 남은 만큼 사라진다.
   * carryLeft는 그 주가 끝나고 남은 이월 코인, carryExpired는 그 주를 끝으로 사라지는 이월 코인.
   * @returns {{week:number, uses:number, coins:number, cumulative:number, remaining:number, carryLeft:number, carryExpired:number,
   *            cells:{uses:number, coins:number, groups:{count:number, levels:Record<string,number>, perUse:number}[]}[]}[]}
   */
  function buildSchedule(plan) {
    const rows = [];
    let cumulative = 0;
    let carryLeft = plan.carry || 0;
    let coinsLeft = plan.coins;
    for (let week = 0; week < plan.weeks; week++) {
      const cells = plan.chars.map((c) => {
        const groups = [];
        for (let index = week * c.weekly; index < (week + 1) * c.weekly; index++) {
          const levels = useLevels(c, index);
          const last = groups[groups.length - 1];
          if (last && STAT_KEYS.every((key) => last.levels[key] === levels[key])) last.count++;
          else groups.push({ count: 1, levels, perUse: levelsCost(levels) });
        }
        return { uses: c.weekly, coins: sum(groups, (g) => g.count * g.perUse), groups };
      });
      const coins = sum(cells, (cell) => cell.coins);
      cumulative += coins;
      const fromCarry = week < (plan.carryWeeks || 0) ? Math.min(carryLeft, coins) : 0;
      carryLeft -= fromCarry;
      coinsLeft -= coins - fromCarry;
      // 이월 코인을 쓸 수 있는 마지막 주가 지나면 남은 이월 코인은 사라진다.
      const carryExpired = carryLeft && week + 1 >= (plan.carryWeeks || 0) ? carryLeft : 0;
      carryLeft -= carryExpired;
      rows.push({ week: week + 1, uses: sum(cells, (cell) => cell.uses), coins, cumulative, remaining: coinsLeft + carryLeft, carryLeft, carryExpired, cells });
    }
    return rows;
  }

  /**
   * 이번 달 코인을 쓸 주: 오늘이 든 주부터 다음 달 7일(이월 기한)이 든 주까지. 주는 목요일 0시(주간 초기화)에 시작하고,
   * 이번 달 1일 앞과 다음 달 7일 뒤는 잘라 낸다(이번 달 코인은 1일부터 생기고 다음 달 7일 23:59:59에 사라진다).
   * 날짜는 한국 시간 기준으로 넘긴다.
   *
   * 오늘이 1~7일이면 지난달 이월 코인이 아직 남아 있다. carryWeeks는 그 코인을 쓸 수 있는 앞쪽 주 수
   * (이번 달 7일까지 걸친 주, 이번 주를 빼면 그만큼 줄어든다).
   * @param {{year:number, month:number, day:number}} today month는 1~12
   * @param {boolean} [includeCurrent=true] false면 이번 주를 빼고 다음 주부터 센다
   * @returns {{year:number, month:number, day:number, days:number,
   *            deadline:{year:number, month:number, day:number}, carryDeadline:{year:number, month:number, day:number}|null,
   *            carryWeeks:number,
   *            weeks:{start:{month:number, day:number}, end:{month:number, day:number}, current:boolean, carryIn:boolean, nextMonth:boolean}[]}}
   */
  function remainingWeeks(today, includeCurrent = true) {
    const { year, month, day } = today;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    // 날짜는 이번 달 1일을 1로 센다. 다음 달 d일은 days + d.
    const last = days + CARRY_DAYS;
    const at = (n) => (n <= days ? { month, day: n } : { month: next.month, day: n - days });
    const carryOpen = day <= CARRY_DAYS;
    const currentStart = day - ((weekday - 4 + 7) % 7);
    const all = [];
    for (let start = currentStart; start <= last; start += 7) {
      const from = Math.max(1, start);
      all.push({
        start: at(from),
        end: at(Math.min(start + 6, last)),
        current: start === currentStart,
        carryIn: carryOpen && from <= CARRY_DAYS,
        nextMonth: from > days,
      });
    }
    const weeks = includeCurrent ? all : all.slice(1);
    return {
      year,
      month,
      day,
      days,
      deadline: { ...next, day: CARRY_DAYS },
      carryDeadline: carryOpen ? { year, month, day: CARRY_DAYS } : null,
      carryWeeks: weeks.filter((w) => w.carryIn).length,
      weeks,
    };
  }

  return { LEVEL_COST, MAX_LEVEL, CARRY_DAYS, STATS, STAT_KEYS, TIE_ORDER, statText, stepCost, buildPlan, useLevels, buildSchedule, remainingWeeks };
});
