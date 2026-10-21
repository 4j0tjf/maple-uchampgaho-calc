/**
 * 화면. 입력이 바뀌면 상태를 저장하고 플랜·주차·계산식만 다시 그린다.
 * 입력 칸(캐릭터 목록)은 캐릭터를 더하거나 뺄 때만 다시 그려서, 이름을 치는 동안 포커스를 잃지 않게 한다.
 */
(function () {
  "use strict";

  const P = window.GahoPlan;
  const STORAGE_KEY = "uchamp-gaho:v1";
  const MAX_WEEKLY = 99;
  const MAX_WEIGHT = 10;
  const MIXED = "mixed";

  const $ = (selector) => document.querySelector(selector);
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  const statOf = (key) => P.STATS.find((s) => s.key === key);

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  const svg = (path, viewBox = "0 0 12 12") => {
    const wrap = document.createElement("span");
    wrap.className = "icon";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `<svg viewBox="${viewBox}" width="12" height="12"><path d="${path}" fill="currentColor"/></svg>`;
    return wrap;
  };
  const upIcon = () => svg("M6 2.5 11 9H1z");
  const downIcon = () => svg("M6 9.5 1 3h10z");
  const removeIcon = () => svg("M3.2 2 6 4.8 8.8 2 10 3.2 7.2 6 10 8.8 8.8 10 6 7.2 3.2 10 2 8.8 4.8 6 2 3.2z");

  /* ---------- 상태 ---------- */

  /** 한국 날짜 기준 오늘(코인 초기화와 주간 초기화가 한국 시간이다). */
  function kstToday() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;
  const parseMonth = (key) => {
    const [year, month] = String(key).split("-").map(Number);
    return { year, month };
  };
  const shiftMonth = ({ year, month }, delta) => {
    const index = year * 12 + (month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  };

  const emptyFixed = () => Object.fromEntries(P.STAT_KEYS.map((key) => [key, null]));
  let seq = 0;
  const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

  function exampleState() {
    const today = kstToday();
    return {
      example: true,
      coins: 20000,
      month: monthKey(today.year, today.month),
      weeksOverride: null,
      weights: { ...P.WEIGHT_PRESETS.even.weights },
      characters: [
        { id: uid(), name: "본캐", weekly: 1, fixed: { ...emptyFixed(), boss: 5, ied: 5 } },
        { id: uid(), name: "부캐 1", weekly: 1, fixed: emptyFixed() },
        { id: uid(), name: "부캐 2", weekly: 1, fixed: emptyFixed() },
      ],
    };
  }

  const intIn = (value, min, max, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  /** 저장본이 깨졌거나 옛 형식이어도 화면이 뜨도록 값마다 확인한다. */
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const today = kstToday();
    const month = /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : monthKey(today.year, today.month);
    const weights = {};
    for (const key of P.STAT_KEYS) weights[key] = intIn(raw.weights?.[key], 0, MAX_WEIGHT, 1);
    const characters = Array.isArray(raw.characters)
      ? raw.characters.slice(0, 60).map((c) => {
          const fixed = emptyFixed();
          for (const key of P.STAT_KEYS) {
            const value = c?.fixed?.[key];
            fixed[key] = value == null ? null : intIn(value, 0, P.MAX_LEVEL, null);
          }
          return { id: typeof c?.id === "string" ? c.id : uid(), name: String(c?.name ?? "").slice(0, 20), weekly: intIn(c?.weekly, 0, MAX_WEEKLY, 1), fixed };
        })
      : [];
    return {
      example: Boolean(raw.example),
      coins: intIn(raw.coins, 0, 99999999, 0),
      month,
      weeksOverride: raw.weeksOverride == null ? null : intIn(raw.weeksOverride, 0, 6, null),
      weights,
      characters,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 저장할 수 없는 브라우저(사생활 보호 창 등)에서는 이번 탭에서만 유지한다. */
    }
  }

  let state = load() || exampleState();

  /** 사용자가 값을 바꿨다. 예시 표시를 끄고 저장한 뒤 결과를 다시 그린다. */
  function touch() {
    state.example = false;
    save();
    renderExampleNote();
    renderResults();
  }

  function monthData() {
    const { year, month } = parseMonth(state.month);
    const info = P.monthInfo(year, month);
    const weeks = state.weeksOverride ?? info.weeks.length;
    return { info, weeks, calendar: weeks === info.weeks.length };
  }

  /* ---------- 공용 입력 ---------- */

  /**
   * 숫자 + 위/아래 화살표. 위 화살표는 +1, 아래 화살표는 −1. 입력 칸에서 키보드 ↑↓도 같다.
   * @returns {{node: HTMLElement, set: (value:number) => void}}
   */
  function stepper({ id, label, value, min, max, onChange, size }) {
    let current = value;
    const input = h("input", { id, class: "stepper-input", inputmode: "numeric", autocomplete: "off", "aria-label": label, value: String(value) });
    const up = h("button", { type: "button", class: "stepper-btn", "aria-label": `${label} 1 늘리기`, tabindex: "-1" }, upIcon());
    const down = h("button", { type: "button", class: "stepper-btn", "aria-label": `${label} 1 줄이기`, tabindex: "-1" }, downIcon());
    const sync = () => {
      up.disabled = current >= max;
      down.disabled = current <= min;
    };
    const set = (next, { silent = false } = {}) => {
      const n = intIn(next, min, max, current);
      input.value = String(n);
      if (n === current) return sync();
      current = n;
      sync();
      if (!silent) onChange(n);
    };
    up.addEventListener("click", () => set(current + 1));
    down.addEventListener("click", () => set(current - 1));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        set(current + (event.key === "ArrowUp" ? 1 : -1));
      }
    });
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits) set(Number(digits));
    });
    input.addEventListener("blur", () => set(input.value.replace(/\D/g, "") || min));
    sync();
    const node = h("div", { class: `stepper${size ? ` stepper-${size}` : ""}` }, input, h("div", { class: "stepper-arrows" }, up, down));
    return { node, set: (n) => set(n, { silent: true }) };
  }

  const LEVEL_OPTIONS = [
    ["auto", "자동"],
    ["0", "안 씀"],
    ...[1, 2, 3, 4, 5].map((level) => [String(level), `${level}단계`]),
  ];
  const levelValue = (fixed) => (fixed == null ? "auto" : String(fixed));
  const parseLevel = (value) => (value === "auto" ? null : Number(value));

  function levelSelect(id, label, value, onChange, withMixed) {
    const options = withMixed ? [[MIXED, "섞임"], ...LEVEL_OPTIONS] : LEVEL_OPTIONS;
    const select = h("select", { id, class: "level-select", "aria-label": label }, options.map(([v, text]) => h("option", { value: v, hidden: v === MIXED }, text)));
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  /* ---------- 이번 달 조건 ---------- */

  let weeksControl = null;
  const weightControls = {};

  function renderSetup() {
    const coins = $("#coins");
    coins.value = fmt(state.coins);
    coins.addEventListener("input", () => {
      state.coins = intIn(coins.value.replace(/\D/g, "") || 0, 0, 99999999, 0);
      touch();
    });
    coins.addEventListener("blur", () => {
      coins.value = fmt(state.coins);
    });

    const select = $("#month");
    const today = kstToday();
    const options = [];
    for (let delta = -1; delta <= 4; delta++) {
      const m = shiftMonth(today, delta);
      const key = monthKey(m.year, m.month);
      options.push(h("option", { value: key }, `${m.year}년 ${m.month}월${delta === 0 ? " (이번 달)" : delta === 1 ? " (다음 달)" : ""}`));
    }
    if (!options.some((o) => o.value === state.month)) {
      const m = parseMonth(state.month);
      options.unshift(h("option", { value: state.month }, `${m.year}년 ${m.month}월`));
    }
    select.replaceChildren(...options);
    select.value = state.month;
    select.addEventListener("change", () => {
      state.month = select.value;
      state.weeksOverride = null;
      weeksControl.set(monthData().weeks);
      touch();
    });

    weeksControl = stepper({
      id: "weeks",
      label: "주 수",
      value: monthData().weeks,
      min: 0,
      max: 6,
      onChange: (value) => {
        state.weeksOverride = value === monthData().info.weeks.length ? null : value;
        touch();
      },
    });
    $("#weeks-slot").replaceChildren(weeksControl.node);

    const grid = $("#weights");
    for (const key of P.TIE_ORDER) {
      const stat = statOf(key);
      const control = stepper({
        id: `weight-${key}`,
        label: `${stat.short} 가치`,
        value: state.weights[key],
        min: 0,
        max: MAX_WEIGHT,
        size: "sm",
        onChange: (value) => {
          state.weights[key] = value;
          renderPresetButtons();
          touch();
        },
      });
      weightControls[key] = control;
      grid.append(h("div", { class: "weight" }, h("label", { for: `weight-${key}` }, stat.short), control.node));
    }
    for (const button of document.querySelectorAll("[data-preset]")) {
      button.addEventListener("click", () => {
        state.weights = { ...P.WEIGHT_PRESETS[button.dataset.preset].weights };
        for (const key of P.STAT_KEYS) weightControls[key].set(state.weights[key]);
        renderPresetButtons();
        touch();
      });
    }
    renderPresetButtons();

    $("#add-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#new-name");
      const name = input.value.trim() || `캐릭터 ${state.characters.length + 1}`;
      state.characters.push({ id: uid(), name: name.slice(0, 20), weekly: 1, fixed: emptyFixed() });
      input.value = "";
      renderCharacters();
      touch();
    });

    $("#clear-example").addEventListener("click", () => {
      state = { ...state, example: false, coins: 0, characters: [] };
      $("#coins").value = "0";
      renderCharacters();
      touch();
      $("#coins").focus();
    });
  }

  function renderPresetButtons() {
    for (const button of document.querySelectorAll("[data-preset]")) {
      const preset = P.WEIGHT_PRESETS[button.dataset.preset].weights;
      button.setAttribute("aria-pressed", String(P.STAT_KEYS.every((key) => preset[key] === state.weights[key])));
    }
  }

  function renderExampleNote() {
    $("#example-note").hidden = !state.example;
  }

  /* ---------- 캐릭터 ---------- */

  function renderCharacters() {
    const list = $("#char-list");
    list.replaceChildren();
    if (!state.characters.length) {
      list.append(h("p", { class: "empty" }, "아직 캐릭터가 없습니다. 위 칸에 이름을 넣고 캐릭터 추가를 누르세요."));
      return;
    }
    list.append(
      h("div", { class: "char-head", "aria-hidden": "true" },
        h("span", null, "캐릭터"),
        h("span", null, "주간 사용"),
        P.STATS.map((s) => h("span", null, s.short)),
        h("span", null, "한 번에"),
        h("span", null, "")),
    );
    state.characters.forEach((c) => list.append(charRow(c)));
  }

  function charRow(c) {
    const allValue = () => {
      const values = new Set(P.STAT_KEYS.map((key) => levelValue(c.fixed[key])));
      return values.size === 1 ? [...values][0] : MIXED;
    };
    const statSelects = {};
    let allSelect = null;

    const name = h("input", {
      id: `name-${c.id}`,
      class: "name-input",
      value: c.name,
      maxlength: "20",
      autocomplete: "off",
      "aria-label": "캐릭터 이름",
      oninput: (event) => {
        c.name = event.target.value;
        touch();
      },
    });
    const weekly = stepper({
      id: `weekly-${c.id}`,
      label: "주간 사용 횟수",
      value: c.weekly,
      min: 0,
      max: MAX_WEEKLY,
      onChange: (value) => {
        c.weekly = value;
        touch();
      },
    });

    const cells = P.STATS.map((s) => {
      const id = `fix-${s.key}-${c.id}`;
      const select = levelSelect(id, `${s.label} 단계`, levelValue(c.fixed[s.key]), (value) => {
        c.fixed[s.key] = parseLevel(value);
        allSelect.value = allValue();
        select.classList.toggle("is-fixed", c.fixed[s.key] != null);
        touch();
      });
      select.classList.toggle("is-fixed", c.fixed[s.key] != null);
      statSelects[s.key] = select;
      return h("div", { class: "cell" }, h("label", { class: "cell-label", for: id }, s.short), select);
    });

    allSelect = levelSelect(`fix-all-${c.id}`, "다섯 능력치 한 번에", allValue(), (value) => {
      if (value === MIXED) return;
      for (const key of P.STAT_KEYS) {
        c.fixed[key] = parseLevel(value);
        statSelects[key].value = value;
        statSelects[key].classList.toggle("is-fixed", c.fixed[key] != null);
      }
      touch();
    }, true);

    const remove = h("button", {
      type: "button",
      class: "icon-btn",
      "aria-label": "이 캐릭터 삭제",
      title: "삭제",
      onclick: () => {
        state.characters = state.characters.filter((x) => x !== c);
        renderCharacters();
        touch();
      },
    }, removeIcon());

    return h("div", { class: "char-row" },
      h("div", { class: "c-name" }, name),
      h("div", { class: "c-weekly cell" }, h("label", { class: "cell-label", for: `weekly-${c.id}` }, "주간 사용"), weekly.node),
      h("div", { class: "c-stats" }, cells),
      h("div", { class: "c-all cell" }, h("label", { class: "cell-label", for: `fix-all-${c.id}` }, "한 번에"), allSelect),
      h("div", { class: "c-remove" }, remove),
    );
  }

  /* ---------- 결과 ---------- */

  function renderResults() {
    const { info, weeks, calendar } = monthData();
    const plan = P.buildPlan({ coins: state.coins, weeks, weights: state.weights, characters: state.characters });
    renderWeeksHint(info, weeks, calendar);
    renderStatus(plan);
    renderSummary(plan);
    renderPlanTable(plan);
    renderNext(plan);
    renderSchedule(plan, P.buildSchedule(plan), info, calendar);
    renderFormula(plan, weeks);
  }

  function renderWeeksHint(info, weeks, calendar) {
    $("#month-hint").textContent = `${info.days}일 · 목요일(주간 초기화) ${info.weeks.length}번`;
    const hint = $("#weeks-hint");
    if (calendar) {
      hint.replaceChildren(`${info.month}월에 시작하는 주 ${info.weeks.length}개로 계산합니다.`);
    } else {
      const reset = h("button", { type: "button", class: "link-btn", onclick: () => {
        state.weeksOverride = null;
        weeksControl.set(info.weeks.length);
        touch();
      } }, `달력대로 ${info.weeks.length}주`);
      hint.replaceChildren(`직접 정한 ${weeks}주로 계산합니다. `, reset);
    }
  }

  const activeChars = (plan) => plan.chars.filter((c) => c.uses > 0);

  function renderStatus(plan) {
    const chip = $("#status-chip");
    let tone = "neutral";
    let text;
    if (!plan.chars.length) text = "캐릭터를 추가하세요";
    else if (!plan.totalUses) text = "사용 횟수가 0입니다";
    else if (plan.shortfall) {
      tone = "bad";
      text = `고정 단계가 ${fmt(plan.shortfall)}코인 넘침`;
    } else if (plan.maxed) {
      tone = "good";
      text = `모두 5단계 · ${fmt(plan.leftover)}코인 남음`;
    } else if (!plan.autoSlots) {
      tone = "good";
      text = `고정 단계만 사용 · ${fmt(plan.leftover)}코인 남음`;
    } else {
      tone = "good";
      text = plan.leftover ? `배분 완료 · ${fmt(plan.leftover)}코인 남음` : "배분 완료 · 남는 코인 없음";
    }
    chip.className = `chip chip-${tone}`;
    chip.textContent = text;
  }

  function renderSummary(plan) {
    const base = Math.max(plan.coins, plan.used) || 1;
    const pct = (n) => `${(Math.max(0, n) / base) * 100}%`;
    const over = plan.used > plan.coins;
    const tiles = [
      { label: "월간 코인", value: fmt(plan.coins), sub: `${plan.weeks}주 기준` },
      { label: "쓰는 코인", value: fmt(plan.used), sub: `고정 ${fmt(plan.fixedCoins)} · 자동 ${fmt(plan.autoCoins)}` },
      over
        ? { label: "모자란 코인", value: fmt(-plan.leftover), sub: "고정 단계를 낮추거나 횟수를 줄이세요", tone: "bad" }
        : { label: "남는 코인", value: fmt(plan.leftover), sub: plan.leftover && !plan.maxed && plan.autoSlots ? "한 단계를 더 올리기엔 모자람" : "" },
      { label: "월 사용 횟수", value: `${fmt(plan.totalUses)}회`, sub: `캐릭터 ${activeChars(plan).length}명` },
    ];
    $("#summary").replaceChildren(
      h("div", { class: "tiles" }, tiles.map((t) =>
        h("div", { class: `tile${t.tone ? ` tile-${t.tone}` : ""}` },
          h("span", { class: "tile-label" }, t.label),
          h("span", { class: "tile-value" }, t.value),
          t.sub ? h("span", { class: "tile-sub" }, t.sub) : null))),
      h("div", { class: "coin-bar", role: "img", "aria-label": `월간 코인 ${fmt(plan.coins)} 중 고정 ${fmt(plan.fixedCoins)}, 자동 ${fmt(plan.autoCoins)}, 남음 ${fmt(Math.max(0, plan.leftover))}` },
        h("span", { class: "seg seg-fixed", style: `width:${pct(plan.fixedCoins)}` }),
        h("span", { class: "seg seg-auto", style: `width:${pct(plan.autoCoins)}` }),
        h("span", { class: "seg seg-left", style: `width:${pct(plan.leftover)}` }),
        over ? h("span", { class: "seg-limit", style: `left:${pct(plan.coins)}` }) : null),
      h("div", { class: "legend" },
        h("span", null, h("i", { class: "sw sw-fixed" }), "고정"),
        h("span", null, h("i", { class: "sw sw-auto" }), "자동 배분"),
        h("span", null, h("i", { class: "sw sw-left" }), "남음"),
        over ? h("span", null, h("i", { class: "sw sw-limit" }), "월간 코인 한도") : null),
    );
  }

  function pips(stat) {
    return h("span", { class: `pips${stat.mode === "fixed" ? " pips-fixed" : ""}`, "aria-hidden": "true" },
      [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= stat.level ? "on" : stat.up && i === stat.level + 1 ? "half" : null })));
  }

  function levelCell(stat) {
    const off = stat.level === 0 && !stat.up;
    return h("td", { class: "lv" },
      h("div", { class: "lv-top" },
        h("span", { class: `lv-num${off ? " lv-off" : ""}` }, off ? "안 씀" : stat.level ? `${stat.level}단계` : "0단계"),
        h("span", { class: `tag tag-${stat.mode}` }, stat.mode === "fixed" ? "고정" : "자동")),
      pips(stat),
      stat.up ? h("div", { class: "lv-up" }, `${stat.level + 1}단계 ${stat.up}회`) : null);
  }

  function effectText(c) {
    const parts = P.STATS.filter((s) => c.stats[s.key].level > 0).map((s) => `${s.short} ${P.statText(s.key, c.stats[s.key].level)}`);
    return parts.length ? parts.join(" · ") : "능력치 없음";
  }

  function renderPlanTable(plan) {
    const target = $("#plan-table");
    if (!plan.chars.length) {
      target.replaceChildren(h("p", { class: "empty" }, "캐릭터를 추가하면 캐릭터별 단계가 여기에 나옵니다."));
      return;
    }
    const head = h("tr", null,
      h("th", { scope: "col" }, "캐릭터"),
      h("th", { scope: "col", class: "num" }, "월 사용"),
      P.STATS.map((s) => h("th", { scope: "col" }, s.short)),
      h("th", { scope: "col", class: "num" }, "1회 코인"),
      h("th", { scope: "col", class: "num" }, "월 코인"));
    const rows = plan.chars.map((c) => {
      if (!c.uses) {
        return h("tr", { class: "row-idle" },
          h("th", { scope: "row" }, h("span", { class: "who" }, c.name || "이름 없음"), h("span", { class: "effect" }, "이번 달 사용 안 함")),
          h("td", { class: "num" }, "0회"),
          h("td", { colspan: String(P.STATS.length), class: "muted" }, "주간 사용 횟수를 1 이상으로 올리면 계산합니다."),
          h("td", { class: "num" }, "—"),
          h("td", { class: "num" }, "0"));
      }
      return h("tr", null,
        h("th", { scope: "row" }, h("span", { class: "who" }, c.name || "이름 없음"), h("span", { class: "effect" }, effectText(c))),
        h("td", { class: "num" }, `${fmt(c.uses)}회`, h("span", { class: "sub" }, `주 ${c.weekly}회`)),
        P.STATS.map((s) => levelCell(c.stats[s.key])),
        h("td", { class: "num" }, fmt(c.perUse), c.upCoins ? h("span", { class: "sub" }, `+${fmt(c.upCoins)} (위 단계)`) : null),
        h("td", { class: "num strong" }, fmt(c.monthly)));
    });
    const foot = h("tr", null,
      h("th", { scope: "row" }, "합계"),
      h("td", { class: "num" }, `${fmt(plan.totalUses)}회`),
      h("td", { colspan: String(P.STATS.length) }),
      h("td", { class: "num" }),
      h("td", { class: "num strong" }, fmt(plan.used)));
    target.replaceChildren(
      h("div", { class: "table-scroll" },
        h("table", { class: "grid-table plan-table" }, h("thead", null, head), h("tbody", null, rows), h("tfoot", null, foot))));
  }

  function renderNext(plan) {
    const target = $("#next-hint");
    if (plan.shortfall) {
      target.textContent = "고정한 단계만으로 월간 코인을 넘어서 자동 칸은 모두 0단계로 두었습니다.";
    } else if (plan.next) {
      const c = plan.chars[plan.next.charIndex];
      target.textContent = `다음으로 올릴 칸은 ${c.name || "이름 없음"}의 ${statOf(plan.next.key).short} ${plan.next.level}단계(1회 +${fmt(plan.next.step)}코인)입니다. 코인이 ${fmt(plan.next.missing)}개 더 있으면 1회를 올릴 수 있습니다.`;
    } else if (plan.maxed && plan.leftover > 0) {
      target.textContent = `자동 칸이 모두 5단계라 ${fmt(plan.leftover)}코인이 남습니다. 주간 사용 횟수를 늘리거나 캐릭터를 추가해도 됩니다.`;
    } else {
      target.textContent = "";
    }
  }

  function renderSchedule(plan, rows, info, calendar) {
    const target = $("#schedule");
    const chars = activeChars(plan);
    if (!chars.length || !rows.length) {
      target.replaceChildren(h("p", { class: "empty" }, "사용할 캐릭터와 주 수가 있으면 주차별 코인이 여기에 나옵니다."));
      return;
    }
    const indices = plan.chars.map((c, i) => (c.uses ? i : -1)).filter((i) => i >= 0);
    const period = (week) => {
      if (!calendar) return "—";
      const w = info.weeks[week - 1];
      return w.start === w.end ? `${info.month}/${w.start}` : `${info.month}/${w.start}~${info.month}/${w.end}`;
    };
    const head = h("tr", null,
      h("th", { scope: "col" }, "주차"),
      h("th", { scope: "col" }, "기간"),
      indices.map((i) => h("th", { scope: "col", class: "num" }, plan.chars[i].name || "이름 없음")),
      h("th", { scope: "col", class: "num" }, "주 합계"),
      h("th", { scope: "col", class: "num" }, "남은 코인"));
    const body = rows.map((row) =>
      h("tr", null,
        h("th", { scope: "row" }, `${row.week}주차`),
        h("td", { class: "muted" }, period(row.week)),
        indices.map((i) => {
          const cell = row.cells[i];
          return h("td", { class: "num" },
            fmt(cell.coins),
            h("span", { class: "sub" }, `${cell.uses}회`),
            cell.ups.map((u) => h("span", { class: "sub up" }, `${statOf(u.key).short} ${u.level}단계 ${u.count}회`)));
        }),
        h("td", { class: "num strong" }, fmt(row.coins)),
        h("td", { class: `num${row.remaining < 0 ? " bad" : ""}` }, fmt(row.remaining))));
    target.replaceChildren(
      h("div", { class: "table-scroll" }, h("table", { class: "grid-table" }, h("thead", null, head), h("tbody", null, body))),
      h("p", { class: "hint" },
        calendar
          ? "목요일 0시 주간 초기화 기준입니다. 마지막 주는 다음 달 1일 0시 코인 초기화 전까지만 셉니다. "
          : "",
        "한 단계 위로 쓰는 횟수는 레이드로 코인이 쌓인 달 후반에 두었습니다. 남은 코인은 월간 코인을 달 초에 모두 가졌다고 보고 뺀 값입니다."),
    );
  }

  function formulaStep(title, equation, lines) {
    return h("li", null,
      h("h3", null, title),
      h("div", { class: "eq" }, h("code", null, equation), lines.length ? h("div", { class: "eq-lines" }, lines.map((line) => h("code", null, line))) : null));
  }

  function renderFormula(plan, weeks) {
    const target = $("#formula");
    if (!plan.chars.length) {
      target.replaceChildren(h("p", { class: "empty" }, "캐릭터를 추가하면 실제 숫자로 계산 과정을 보여 줍니다."));
      return;
    }
    const steps = [];

    steps.push(formulaStep("월 사용 횟수", `월 사용 횟수 = 주간 사용 횟수 × 주 수(${weeks})`, [
      ...plan.chars.map((c) => `${c.name || "이름 없음"}  ${c.weekly} × ${weeks} = ${fmt(c.uses)}회`),
      `합계  ${fmt(plan.totalUses)}회`,
    ]));

    const fixedLines = [];
    for (const c of plan.chars) {
      const fixed = P.STATS.filter((s) => c.stats[s.key].mode === "fixed");
      if (!fixed.length) continue;
      const parts = fixed.map((s) => {
        const level = c.stats[s.key].level;
        return level ? `${s.short} ${level}단계 ${fmt(P.LEVEL_COST[level])}` : `${s.short} 안 씀 0`;
      });
      fixedLines.push(`${c.name || "이름 없음"}  ${parts.join(" + ")} = ${fmt(c.fixedPerUse)} × ${fmt(c.uses)}회 = ${fmt(c.fixedPerUse * c.uses)}`);
    }
    fixedLines.push(fixedLines.length ? `합계  ${fmt(plan.fixedCoins)}` : "고정한 칸이 없습니다  0");
    steps.push(formulaStep("고정 코인", "고정 코인 = (고정한 단계의 1회 코인 합) × 월 사용 횟수", fixedLines));

    steps.push(formulaStep("자동 배분 코인", "자동 배분 코인 = 월간 코인 − 고정 코인",
      plan.shortfall
        ? [`${fmt(plan.coins)} − ${fmt(plan.fixedCoins)} = −${fmt(plan.shortfall)}  →  모자라서 0`]
        : [`${fmt(plan.coins)} − ${fmt(plan.fixedCoins)} = ${fmt(plan.autoBudget)}`]));

    const even = P.STAT_KEYS.every((key) => state.weights[key] === state.weights[P.STAT_KEYS[0]]);
    const order = even
      ? "가치가 모두 같아 1단계에 드는 코인이 싼 단계부터 채웁니다. 같은 단계 안에서는 보뎀 → 방무 → 공/마 → 크뎀 → 올스탯, 위쪽 캐릭터 순서입니다."
      : `가치 ÷ (그 단계로 올리는 코인)이 큰 칸부터 채웁니다. 가치 ${P.TIE_ORDER.map((key) => `${statOf(key).short} ${state.weights[key]}`).join(" · ")}`;
    const levelLines = plan.levels
      .filter((row) => row.slots)
      .map((row) => `${row.level}단계 (+${row.step})  ${fmt(row.filled)} / ${fmt(row.slots)}칸·회 × ${row.step} = ${fmt(row.coins)}`);
    if (levelLines.length) levelLines.push(`합계  ${fmt(plan.autoCoins)}`);
    else levelLines.push("자동 칸이 없습니다  0");
    steps.push(formulaStep("자동 칸 채우기", "칸·회 = 자동 칸(캐릭터 × 능력치) 하나를 한 번 쓰는 것. 단계를 올릴 때 더 드는 코인: 1단계 50 · 2단계 75 · 3단계 75 · 4단계 100 · 5단계 200", [order, ...levelLines]));

    steps.push(formulaStep("남는 코인", "남는 코인 = 월간 코인 − 고정 코인 − 자동 배분에 쓴 코인", [
      `${fmt(plan.coins)} − ${fmt(plan.fixedCoins)} − ${fmt(plan.autoCoins)} = ${plan.leftover < 0 ? "−" : ""}${fmt(Math.abs(plan.leftover))}`,
    ]));

    target.replaceChildren(h("ol", { class: "formula" }, steps));
  }

  function renderReference() {
    const head = h("tr", null,
      h("th", { scope: "col" }, "단계"),
      h("th", { scope: "col", class: "num" }, "1회 코인"),
      h("th", { scope: "col", class: "num" }, "앞 단계보다"),
      h("th", { scope: "col", class: "num" }, "1단계당 평균"),
      P.STATS.map((s) => h("th", { scope: "col", class: "num" }, s.short)));
    const rows = [1, 2, 3, 4, 5].map((level) =>
      h("tr", null,
        h("th", { scope: "row" }, `${level}단계`),
        h("td", { class: "num strong" }, fmt(P.LEVEL_COST[level])),
        h("td", { class: "num" }, `+${fmt(P.stepCost(level - 1))}`),
        h("td", { class: "num" }, fmt(Math.round((P.LEVEL_COST[level] / level) * 10) / 10)),
        P.STATS.map((s) => h("td", { class: "num" }, P.statText(s.key, level)))));
    $("#reference").replaceChildren(
      h("div", { class: "table-scroll" }, h("table", { class: "grid-table ref-table" }, h("thead", null, head), h("tbody", null, rows))));
  }

  /* ---------- 시작 ---------- */

  renderSetup();
  renderExampleNote();
  renderCharacters();
  renderReference();
  renderResults();
})();
