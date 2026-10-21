/**
 * 챔피언의 가호 월간 코인 배분 계산. 화면(app.js)과 테스트(tests/plan.test.js)가 함께 쓴다.
 *
 * 수치 출처: 메이플스토리 공식 가이드 「유니온 챔피언」, 나무위키 「유니온 챔피언」 (2026-10 확인).
 * 패치로 코인이나 능력치가 바뀌면 LEVEL_COST와 STATS만 고친다.
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

  /**
   * @param {{coins:number, weeks:number,
   *          characters:{id?:string, name:string, weekly:number, fixed?:Record<string, number|null>}[]}} input
   *   fixed[key]가 null/undefined면 자동, 0~5면 그 단계로 매번 고정(0은 안 씀).
   *
   * 자동 칸 = 캐릭터 × 능력치. 칸마다 "사용 1회를 l-1단계에서 l단계로 올리는" 일을 모아 두고,
   * 올리는 코인이 싼 것부터(1단계 50 → 2·3단계 75 → 4단계 100 → 5단계 200) 남은 코인이 허락하는 만큼 채운다.
   * 그래서 다섯 능력치가 같은 단계로 고르게 오르고, 남는 코인은 다음 칸 하나를 올리는 코인보다 적다.
   * 사용 1회 단위로 채우므로 칸 하나는 "기본 단계 + 이번 달 n회만 한 단계 위"가 될 수 있다.
   */
  function buildPlan(input) {
    const coins = toInt(input.coins);
    const weeks = toInt(input.weeks);

    const chars = (input.characters || []).map((c) => {
      const weekly = toInt(c.weekly);
      const uses = weekly * weeks;
      const stats = {};
      let fixedPerUse = 0;
      for (const key of STAT_KEYS) {
        const fixed = c.fixed ? c.fixed[key] : null;
        if (fixed == null) {
          // reach[l] = l단계 이상으로 쓰는 횟수
          stats[key] = { mode: "auto", level: 0, up: 0, reach: [uses, 0, 0, 0, 0, 0] };
        } else {
          const level = clampLevel(fixed);
          stats[key] = { mode: "fixed", level, up: 0 };
          fixedPerUse += LEVEL_COST[level];
        }
      }
      return { id: c.id, name: c.name, weekly, uses, stats, fixedPerUse, perUse: 0, upCoins: 0, monthly: 0 };
    });

    const fixedCoins = sum(chars, (c) => c.uses * c.fixedPerUse);
    const autoBudget = Math.max(0, coins - fixedCoins);
    let left = autoBudget;

    const blocks = [];
    chars.forEach((c, charIndex) => {
      if (!c.uses) return;
      for (const key of STAT_KEYS) {
        if (c.stats[key].mode !== "auto") continue;
        for (let level = 1; level <= MAX_LEVEL; level++) blocks.push({ charIndex, key, level, step: stepCost(level - 1) });
      }
    });
    blocks.sort((a, b) =>
      a.step - b.step ||
      a.level - b.level ||
      TIE_ORDER.indexOf(a.key) - TIE_ORDER.indexOf(b.key) ||
      a.charIndex - b.charIndex);

    let next = null;
    for (const block of blocks) {
      const stat = chars[block.charIndex].stats[block.key];
      const available = stat.reach[block.level - 1];
      const filled = Math.min(available, Math.floor(left / block.step));
      stat.reach[block.level] = filled;
      left -= filled * block.step;
      if (filled < available && !next) next = { charIndex: block.charIndex, key: block.key, level: block.level, step: block.step };
    }

    for (const c of chars) {
      for (const key of STAT_KEYS) {
        const stat = c.stats[key];
        if (stat.mode === "auto") {
          let level = 0;
          while (c.uses && level < MAX_LEVEL && stat.reach[level + 1] === c.uses) level++;
          stat.level = level;
          stat.up = level < MAX_LEVEL ? stat.reach[level + 1] : 0;
          delete stat.reach;
        }
        c.perUse += LEVEL_COST[stat.level];
        if (stat.up) c.upCoins += stat.up * stepCost(stat.level);
      }
      c.monthly = c.uses * c.perUse + c.upCoins;
    }

    const used = sum(chars, (c) => c.monthly);
    return {
      coins,
      weeks,
      chars,
      totalUses: sum(chars, (c) => c.uses),
      fixedCoins,
      autoBudget,
      autoCoins: used - fixedCoins,
      used,
      /** 음수면 고정 단계만으로 월 코인을 넘는다. */
      leftover: coins - used,
      shortfall: Math.max(0, fixedCoins - coins),
      autoSlots: blocks.length / MAX_LEVEL,
      /** 자동 칸이 있고 모두 5단계까지 찼는지. */
      maxed: blocks.length > 0 && !next,
      /** 코인이 모자라 다 채우지 못한 첫 칸. missing은 그 칸 1회를 더 올리는 데 모자란 코인. */
      next: next && { ...next, missing: next.step - left },
    };
  }

  /**
   * 캐릭터의 index번째(0부터, 달 안의 순서) 사용에서 능력치별 단계.
   * 한 단계 위로 쓰는 n회는 달의 마지막 사용들에 둔다.
   */
  function useLevels(char, index) {
    const levels = {};
    for (const key of STAT_KEYS) {
      const stat = char.stats[key];
      levels[key] = stat.level + (stat.up && index >= char.uses - stat.up ? 1 : 0);
    }
    return levels;
  }

  const levelsCost = (levels) => sum(STAT_KEYS, (key) => LEVEL_COST[levels[key]]);

  /**
   * 주차별 사용 계획. 주마다 캐릭터별로 같은 단계 조합끼리 묶는다.
   * @returns {{week:number, uses:number, coins:number, cumulative:number, remaining:number,
   *            cells:{uses:number, coins:number, groups:{count:number, levels:Record<string,number>, perUse:number}[]}[]}[]}
   */
  function buildSchedule(plan) {
    const rows = [];
    let cumulative = 0;
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
      rows.push({ week: week + 1, uses: sum(cells, (cell) => cell.uses), coins, cumulative, remaining: plan.coins - cumulative, cells });
    }
    return rows;
  }

  /**
   * 오늘이 든 주부터 이번 달 끝까지의 주. 주는 목요일 0시(주간 초기화)에 시작하고, 달 밖은 잘라 낸다
   * (코인은 매월 1일 0시에 초기화된다). 날짜는 한국 시간 기준으로 넘긴다.
   * @param {{year:number, month:number, day:number}} today month는 1~12
   * @param {boolean} [includeCurrent=true] false면 이번 주를 빼고 다음 주부터 센다
   */
  function remainingWeeks(today, includeCurrent = true) {
    const { year, month, day } = today;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const currentStart = day - ((weekday - 4 + 7) % 7);
    const weeks = [];
    for (let start = currentStart; start <= days; start += 7) {
      weeks.push({ start: Math.max(1, start), end: Math.min(start + 6, days), current: start === currentStart });
    }
    return { year, month, day, days, weeks: includeCurrent ? weeks : weeks.slice(1) };
  }

  return { LEVEL_COST, MAX_LEVEL, STATS, STAT_KEYS, TIE_ORDER, statText, stepCost, buildPlan, useLevels, buildSchedule, remainingWeeks };
});
