/**
 * 화면. 입력이 바뀌면 상태를 저장하고 플랜·주차별 사용·캐릭터 상세만 다시 그린다.
 * 입력 칸(캐릭터 목록)은 캐릭터를 더하거나 뺄 때만 다시 그려서, 이름을 치는 동안 포커스를 잃지 않게 한다.
 */
(function () {
  "use strict";

  const P = window.GahoPlan;
  const STORAGE_KEY = "uchamp-gaho:v1";
  /** 캐릭터 이미지·레벨은 하루 지나면 다시 불러온다(코디를 바꾸면 이미지 주소가 바뀐다). */
  const NEXON_STALE_MS = 24 * 3600 * 1000;
  const MAX_WEEKLY = 99;
  const MIXED = "mixed";
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const $ = (selector) => document.querySelector(selector);
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  const statOf = (key) => P.STATS.find((s) => s.key === key);
  const nameOf = (c) => c.name.trim() || "이름 없음";

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

  const svg = (path) => {
    const wrap = document.createElement("span");
    wrap.className = "icon";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `<svg viewBox="0 0 12 12" width="12" height="12"><path d="${path}" fill="currentColor"/></svg>`;
    return wrap;
  };
  const upIcon = () => svg("M6 2.5 11 9H1z");
  const downIcon = () => svg("M6 9.5 1 3h10z");
  const removeIcon = () => svg("M3.2 2 6 4.8 8.8 2 10 3.2 7.2 6 10 8.8 8.8 10 6 7.2 3.2 10 2 8.8 4.8 6 2 3.2z");

  /* ---------- 상태 ---------- */

  /** 한국 날짜 기준 오늘(코인 초기화와 주간 초기화가 한국 시간이다). */
  function kstToday() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
  }
  const today = kstToday();

  const emptyFixed = () => Object.fromEntries(P.STAT_KEYS.map((key) => [key, null]));
  let seq = 0;
  const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

  function exampleState() {
    return {
      example: true,
      coins: 20000,
      includeCurrent: true,
      characters: [
        { id: uid(), name: "본캐", weekly: 1, fixed: { ...emptyFixed(), boss: 5, ied: 5 }, nexon: null },
        { id: uid(), name: "부캐 1", weekly: 1, fixed: emptyFixed(), nexon: null },
        { id: uid(), name: "부캐 2", weekly: 1, fixed: emptyFixed(), nexon: null },
      ],
    };
  }

  const intIn = (value, min, max, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  /** 넥슨 API 응답에서 화면에 쓰는 값만 남긴다. 이미지는 넥슨 주소만 받는다. */
  function sanitizeNexon(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.image !== "string" || !raw.image.startsWith("https://open.api.nexon.com/")) return null;
    return {
      name: String(raw.name ?? ""),
      image: raw.image,
      level: intIn(raw.level, 0, 999, 0),
      job: String(raw.job ?? ""),
      world: String(raw.world ?? ""),
      fetchedAt: intIn(raw.fetchedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
  }

  /** 저장본이 깨졌거나 옛 형식(계산할 달·가치가 있던 때)이어도 화면이 뜨도록 값마다 확인한다. */
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const characters = Array.isArray(raw.characters)
      ? raw.characters.slice(0, 60).map((c) => {
          const fixed = emptyFixed();
          for (const key of P.STAT_KEYS) {
            const value = c?.fixed?.[key];
            fixed[key] = value == null ? null : intIn(value, 0, P.MAX_LEVEL, null);
          }
          return {
            id: typeof c?.id === "string" ? c.id : uid(),
            name: String(c?.name ?? "").slice(0, 20),
            weekly: intIn(c?.weekly, 0, MAX_WEEKLY, 1),
            fixed,
            nexon: sanitizeNexon(c?.nexon),
          };
        })
      : [];
    return {
      example: Boolean(raw.example),
      coins: intIn(raw.coins, 0, 99999999, 0),
      includeCurrent: raw.includeCurrent !== false,
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

  const weeksNow = () => P.remainingWeeks(today, state.includeCurrent);
  const range = (month, w) => (w.start === w.end ? `${month}/${w.start}` : `${month}/${w.start}~${month}/${w.end}`);

  /* ---------- 캐릭터 이미지 (넥슨 Open API, 계산기 서버가 대신 부른다) ---------- */

  /**
   * checking → ready(서버에 넥슨 키가 있음) | no-key(서버는 있는데 키가 없음) | offline(서버 없이 파일로 열었거나 미리보기).
   * 넥슨 키는 서버의 .env에만 있고 화면은 /api/character만 부른다.
   */
  let imageService = "checking";

  async function checkImageService() {
    try {
      const response = await fetch("api/status", { cache: "no-store" });
      const body = response.ok ? await response.json() : null;
      imageService = body ? (body.nexon ? "ready" : "no-key") : "offline";
    } catch {
      imageService = "offline";
    }
    renderImageNote();
  }

  const lookupError = (short, message) => Object.assign(new Error(message), { short });

  async function fetchCharacter(name) {
    let response;
    try {
      response = await fetch(`api/character?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    } catch {
      throw lookupError("연결 실패", "계산기 서버에 연결하지 못했습니다.");
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw lookupError(body?.error?.short || "불러오기 실패", body?.error?.message || `계산기 서버 오류(${response.status})입니다.`);
    return body;
  }

  /** 캐릭터 id → { state: "loading" } 또는 { state: "error", short, message }. 저장하지 않는다. */
  const nexonStatus = new Map();

  async function loadCharacter(c) {
    const name = c.name.trim();
    if (imageService !== "ready" || !name) return;
    nexonStatus.set(c.id, { state: "loading" });
    refreshCharacterView(c);
    try {
      const data = await fetchCharacter(name);
      if (c.name.trim() !== name || !state.characters.includes(c)) return;
      c.nexon = sanitizeNexon({ ...data, fetchedAt: Date.now() });
      nexonStatus.delete(c.id);
      save();
    } catch (error) {
      if (c.name.trim() !== name) return;
      nexonStatus.set(c.id, { state: "error", short: error.short, message: error.message });
    }
    refreshCharacterView(c);
    renderResults();
  }

  async function loadAll(characters) {
    if (!characters.length) return;
    setImageMessage(`캐릭터 ${characters.length}명의 이미지를 불러오는 중입니다.`);
    await Promise.all(characters.map(loadCharacter));
    const failed = characters.filter((c) => nexonStatus.get(c.id)?.state === "error");
    if (!failed.length) setImageMessage(`캐릭터 ${characters.length}명의 이미지를 불러왔습니다.`);
    else setImageMessage(`${failed.length}명은 불러오지 못했습니다. ${nexonStatus.get(failed[0].id).message}`, true);
  }

  const IMAGE_NOTES = {
    checking: "",
    ready: "캐릭터 이미지·레벨·직업은 넥슨 Open API에서 가져옵니다.",
    "no-key": "서버 .env에 NEXON_API_KEY를 넣고 서버를 다시 시작하면 캐릭터 이미지가 나옵니다.",
    offline: "캐릭터 이미지는 계산기 서버(npm start)로 열었을 때 나옵니다.",
  };

  function setImageMessage(text, bad = false) {
    const node = $("#image-note-text");
    node.textContent = text;
    node.classList.toggle("bad", bad);
  }

  function renderImageNote() {
    $("#image-note").hidden = imageService === "checking";
    $("#image-refresh").hidden = imageService !== "ready";
    setImageMessage(IMAGE_NOTES[imageService]);
  }

  /** 넥슨 캐릭터 이미지(96×96, 투명 배경). 없으면 이름 첫 글자. */
  function avatar(c, size) {
    const image = c.nexon?.image;
    const box = h("span", { class: `avatar avatar-${size}${image ? "" : " avatar-empty"}`, "aria-hidden": "true" });
    if (image) {
      const img = h("img", { src: image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      img.addEventListener("error", () => {
        box.classList.add("avatar-empty");
        box.replaceChildren(c.name.trim().charAt(0) || "?");
      });
      box.append(img);
    } else {
      box.append(c.name.trim().charAt(0) || "?");
    }
    return box;
  }

  const metaText = (c) => (c.nexon ? [`Lv.${c.nexon.level}`, c.nexon.job, c.nexon.world].filter(Boolean).join(" · ") : "");

  /* ---------- 공용 입력 ---------- */

  /**
   * 숫자 + 위/아래 화살표. 위 화살표는 +1, 아래 화살표는 −1. 입력 칸에서 키보드 ↑↓도 같다.
   * @returns {{node: HTMLElement, set: (value:number) => void}}
   */
  function stepper({ id, label, value, min, max, onChange }) {
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
    const node = h("div", { class: "stepper" }, input, h("div", { class: "stepper-arrows" }, up, down));
    return { node, set: (n) => set(n, { silent: true }) };
  }

  const LEVEL_OPTIONS = [["auto", "자동"], ["0", "안 씀"], ...[1, 2, 3, 4, 5].map((level) => [String(level), `${level}단계`])];
  const levelValue = (fixed) => (fixed == null ? "auto" : String(fixed));
  const parseLevel = (value) => (value === "auto" ? null : Number(value));

  function levelSelect(id, label, value, onChange, withMixed) {
    const options = withMixed ? [[MIXED, "섞임"], ...LEVEL_OPTIONS] : LEVEL_OPTIONS;
    const select = h("select", { id, class: "level-select", "aria-label": label }, options.map(([v, text]) => h("option", { value: v, hidden: v === MIXED }, text)));
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  /* ---------- 이번 달 획득 코인 ---------- */

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

    const include = $("#include-current");
    include.checked = state.includeCurrent;
    include.addEventListener("change", () => {
      state.includeCurrent = include.checked;
      touch();
    });

    $("#add-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#new-name");
      const typed = input.value.trim().slice(0, 20);
      const c = { id: uid(), name: typed || `캐릭터 ${state.characters.length + 1}`, weekly: 1, fixed: emptyFixed(), nexon: null };
      state.characters.push(c);
      input.value = "";
      renderCharacters();
      touch();
      if (typed) loadCharacter(c);
    });

    $("#clear-example").addEventListener("click", () => {
      state = { ...state, example: false, coins: 0, characters: [] };
      $("#coins").value = "0";
      renderCharacters();
      touch();
      $("#coins").focus();
    });

    $("#image-refresh").addEventListener("click", () => loadAll(state.characters.filter((c) => c.name.trim())));
  }

  function renderWeeks() {
    const all = P.remainingWeeks(today, true);
    const used = weeksNow();
    const current = all.weeks[0];
    $("#today-label").textContent = `오늘 ${today.month}월 ${today.day}일(${WEEKDAYS[today.weekday]}) 기준 이번 달 남은 주`;
    $("#weeks-count").textContent = `${used.weeks.length}주`;
    $("#week-chips").replaceChildren(...all.weeks.map((w) => {
      const off = w.current && !state.includeCurrent;
      return h("li", { class: `week-chip${w.current ? " is-current" : ""}${off ? " is-off" : ""}` },
        range(all.month, w),
        w.current ? h("span", { class: "week-tag" }, off ? "빼고 계산" : "이번 주") : null);
    }));
    $("#include-current-label").textContent = `이번 주(${range(all.month, current)})에도 쓸 수 있음`;
  }

  function renderExampleNote() {
    $("#example-note").hidden = !state.example;
  }

  /* ---------- 캐릭터 ---------- */

  /** 캐릭터 id → 편집 줄의 이미지·정보 칸. 이름을 치는 동안 줄 전체를 다시 그리지 않고 이 칸만 바꾼다. */
  const rowViews = new Map();

  function refreshCharacterView(c) {
    const view = rowViews.get(c.id);
    if (!view) return;
    view.avatar.replaceChildren(avatar(c, "md"));
    const status = nexonStatus.get(c.id);
    view.meta.className = `char-meta${status?.state === "error" ? " bad" : ""}`;
    view.meta.textContent = status?.state === "loading" ? "불러오는 중…" : status?.state === "error" ? status.short : metaText(c);
    view.meta.title = status?.state === "error" ? status.message : "";
  }

  function renderCharacters() {
    const list = $("#char-list");
    list.replaceChildren();
    rowViews.clear();
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
    for (const c of state.characters) {
      list.append(charRow(c));
      refreshCharacterView(c);
    }
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
      spellcheck: "false",
      "aria-label": "캐릭터 이름",
      oninput: (event) => {
        c.name = event.target.value;
        touch();
      },
      onchange: () => {
        // 이름이 바뀌면 예전 이미지는 다른 캐릭터의 것이다.
        if (c.nexon && c.nexon.name !== c.name.trim()) {
          c.nexon = null;
          nexonStatus.delete(c.id);
          save();
          refreshCharacterView(c);
          renderResults();
        }
        if (!c.nexon) loadCharacter(c);
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
        nexonStatus.delete(c.id);
        renderCharacters();
        touch();
      },
    }, removeIcon());

    const avatarSlot = h("span", { class: "avatar-slot" });
    const meta = h("span", { class: "char-meta" });
    rowViews.set(c.id, { avatar: avatarSlot, meta });

    return h("div", { class: "char-row" },
      h("div", { class: "c-name" }, avatarSlot, h("div", { class: "c-name-text" }, name, meta)),
      h("div", { class: "c-weekly cell" }, h("label", { class: "cell-label", for: `weekly-${c.id}` }, "주간 사용"), weekly.node),
      h("div", { class: "c-stats" }, cells),
      h("div", { class: "c-all cell" }, h("label", { class: "cell-label", for: `fix-all-${c.id}` }, "한 번에"), allSelect),
      h("div", { class: "c-remove" }, remove),
    );
  }

  /* ---------- 결과 ---------- */

  function renderResults() {
    const weeks = weeksNow();
    const plan = P.buildPlan({ coins: state.coins, weeks: weeks.weeks.length, characters: state.characters });
    const rows = P.buildSchedule(plan);
    renderWeeks();
    renderStatus(plan);
    renderSummary(plan);
    renderPlanTable(plan);
    renderNext(plan);
    renderSchedule(plan, rows, weeks);
    renderDetails(plan, rows, weeks);
  }

  const activeChars = (plan) => plan.chars.filter((c) => c.uses > 0);
  /** 화면 상태(state)의 캐릭터. plan.chars와 순서가 같다. */
  const sourceOf = (index) => state.characters[index];

  function renderStatus(plan) {
    const chip = $("#status-chip");
    let tone = "neutral";
    let text;
    if (!plan.chars.length) text = "캐릭터를 추가하세요";
    else if (!plan.weeks) text = "이번 달 남은 주가 없습니다";
    else if (!plan.totalUses) text = "사용 횟수가 0입니다";
    else if (plan.shortfall) {
      tone = "bad";
      text = `고정 단계가 ${fmt(plan.shortfall)}코인 넘침`;
    } else if (plan.maxed) {
      tone = "good";
      text = plan.leftover ? `모두 5단계 · ${fmt(plan.leftover)}코인 남음` : "모두 5단계 · 남는 코인 없음";
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
      { label: "이번 달 코인", value: fmt(plan.coins), sub: `남은 ${plan.weeks}주` },
      { label: "쓰는 코인", value: fmt(plan.used), sub: `고정 ${fmt(plan.fixedCoins)} · 자동 ${fmt(plan.autoCoins)}` },
      over
        ? { label: "모자란 코인", value: fmt(-plan.leftover), sub: "고정 단계를 낮추거나 횟수를 줄이세요", tone: "bad" }
        : { label: "남는 코인", value: fmt(plan.leftover), sub: plan.leftover && !plan.maxed && plan.autoSlots ? "한 단계를 더 올리기엔 모자람" : "" },
      { label: "사용 횟수", value: `${fmt(plan.totalUses)}회`, sub: `캐릭터 ${activeChars(plan).length}명` },
    ];
    $("#summary").replaceChildren(
      h("div", { class: "tiles" }, tiles.map((t) =>
        h("div", { class: `tile${t.tone ? ` tile-${t.tone}` : ""}` },
          h("span", { class: "tile-label" }, t.label),
          h("span", { class: "tile-value" }, t.value),
          t.sub ? h("span", { class: "tile-sub" }, t.sub) : null))),
      h("div", { class: "coin-bar", role: "img", "aria-label": `이번 달 코인 ${fmt(plan.coins)} 중 고정 ${fmt(plan.fixedCoins)}, 자동 ${fmt(plan.autoCoins)}, 남음 ${fmt(Math.max(0, plan.leftover))}` },
        h("span", { class: "seg seg-fixed", style: `width:${pct(plan.fixedCoins)}` }),
        h("span", { class: "seg seg-auto", style: `width:${pct(plan.autoCoins)}` }),
        h("span", { class: "seg seg-left", style: `width:${pct(plan.leftover)}` }),
        over ? h("span", { class: "seg-limit", style: `left:${pct(plan.coins)}` }) : null),
      h("div", { class: "legend" },
        h("span", null, h("i", { class: "sw sw-fixed" }), "고정"),
        h("span", null, h("i", { class: "sw sw-auto" }), "자동 배분"),
        h("span", null, h("i", { class: "sw sw-left" }), "남음"),
        over ? h("span", null, h("i", { class: "sw sw-limit" }), "이번 달 코인 한도") : null),
    );
  }

  function pips(stat) {
    return h("span", { class: `pips${stat.mode === "fixed" ? " pips-fixed" : ""}`, "aria-hidden": "true" },
      [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= stat.level ? "on" : stat.up && i === stat.level + 1 ? "half" : null })));
  }

  /** 월간 플랜 칸. 한 단계 위로 쓰는 횟수가 있으면 "2~3단계"와 단계별 횟수를 함께 적는다. */
  function levelCell(stat, uses) {
    const off = stat.level === 0 && !stat.up;
    const label = off ? "안 씀" : stat.up ? `${stat.level}~${stat.level + 1}단계` : `${stat.level}단계`;
    const split = stat.up
      ? [`${stat.level + 1}단계 ${stat.up}회`, stat.level ? `${stat.level}단계 ${uses - stat.up}회` : `안 씀 ${uses - stat.up}회`].join(" · ")
      : null;
    return h("td", { class: "lv" },
      h("div", { class: "lv-top" },
        h("span", { class: `lv-num${off ? " lv-off" : ""}` }, label),
        h("span", { class: `tag tag-${stat.mode}` }, stat.mode === "fixed" ? "고정" : "자동")),
      pips(stat),
      split ? h("div", { class: "lv-up" }, split) : null);
  }

  function effectText(c) {
    const parts = P.STATS.filter((s) => c.stats[s.key].level > 0).map((s) => `${s.short} ${P.statText(s.key, c.stats[s.key].level)}`);
    return parts.length ? parts.join(" · ") : "능력치 없음";
  }

  function whoCell(index, sub) {
    const source = sourceOf(index);
    return h("th", { scope: "row" },
      h("div", { class: "who" }, avatar(source, "sm"),
        h("div", { class: "who-text" }, h("span", { class: "who-name" }, nameOf(source)), sub ? h("span", { class: "effect" }, sub) : null)));
  }

  function renderPlanTable(plan) {
    const target = $("#plan-table");
    if (!plan.chars.length) {
      target.replaceChildren(h("p", { class: "empty" }, "캐릭터를 추가하면 캐릭터별 단계가 여기에 나옵니다."));
      return;
    }
    const head = h("tr", null,
      h("th", { scope: "col" }, "캐릭터"),
      h("th", { scope: "col", class: "num" }, "사용"),
      P.STATS.map((s) => h("th", { scope: "col" }, s.short)),
      h("th", { scope: "col", class: "num" }, "1회 코인"),
      h("th", { scope: "col", class: "num" }, "월 코인"));
    const rows = plan.chars.map((c, index) => {
      if (!c.uses) {
        return h("tr", { class: "row-idle" },
          whoCell(index, "이번 달 사용 안 함"),
          h("td", { class: "num" }, "0회"),
          h("td", { colspan: String(P.STATS.length), class: "muted" }, plan.weeks ? "주간 사용 횟수를 1 이상으로 올리면 계산합니다." : "이번 달 남은 주가 없습니다."),
          h("td", { class: "num" }, "—"),
          h("td", { class: "num" }, "0"));
      }
      return h("tr", null,
        whoCell(index, effectText(c)),
        h("td", { class: "num" }, `${fmt(c.uses)}회`, h("span", { class: "sub" }, `주 ${c.weekly}회`)),
        P.STATS.map((s) => levelCell(c.stats[s.key], c.uses)),
        h("td", { class: "num" }, fmt(c.perUse), c.upCoins ? h("span", { class: "sub" }, `위 단계 +${fmt(c.upCoins)}`) : null),
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
      target.textContent = "고정한 단계만으로 이번 달 코인을 넘어서 자동 칸은 모두 0단계로 두었습니다.";
    } else if (plan.next) {
      const c = sourceOf(plan.next.charIndex);
      target.textContent = `다음으로 올릴 칸은 ${nameOf(c)}의 ${statOf(plan.next.key).short} ${plan.next.level}단계(1회 +${fmt(plan.next.step)}코인)입니다. 코인이 ${fmt(plan.next.missing)}개 더 있으면 1회를 올릴 수 있습니다.`;
    } else if (plan.maxed && plan.leftover > 0) {
      target.textContent = `자동 칸이 모두 5단계라 ${fmt(plan.leftover)}코인이 남습니다. 주간 사용 횟수를 늘리거나 캐릭터를 추가해도 됩니다.`;
    } else {
      target.textContent = "";
    }
  }

  /** 그 주에 기본 단계보다 한 단계 위로 쓰는 능력치. "보뎀 5단계". */
  const upgradesOf = (char, levels) => P.STAT_KEYS.filter((key) => levels[key] > char.stats[key].level).map((key) => `${statOf(key).short} ${levels[key]}단계`);

  function weekLabel(weeks, row) {
    const w = weeks.weeks[row.week - 1];
    return h("th", { scope: "row", class: "week-cell" },
      h("span", { class: "week-name" }, `${row.week}주차`),
      h("span", { class: "week-range" }, range(weeks.month, w)),
      w.current ? h("span", { class: "week-tag" }, "이번 주") : null);
  }

  function renderSchedule(plan, rows, weeks) {
    const target = $("#schedule");
    const indices = plan.chars.map((c, i) => (c.uses ? i : -1)).filter((i) => i >= 0);
    if (!indices.length || !rows.length) {
      target.replaceChildren(h("p", { class: "empty" }, "사용할 캐릭터와 남은 주가 있으면 주차별 코인이 여기에 나옵니다."));
      return;
    }
    const head = h("tr", null,
      h("th", { scope: "col" }, "주차"),
      indices.map((i) => h("th", { scope: "col", class: "num" },
        h("span", { class: "col-who" }, avatar(sourceOf(i), "xs"), nameOf(sourceOf(i))))),
      h("th", { scope: "col", class: "num" }, "주 코인"),
      h("th", { scope: "col", class: "num" }, "누적"),
      h("th", { scope: "col" }, "남은 코인"));
    const body = rows.map((row) =>
      h("tr", null,
        weekLabel(weeks, row),
        indices.map((i) => {
          const cell = row.cells[i];
          const char = plan.chars[i];
          const ups = [...new Set(cell.groups.flatMap((g) => upgradesOf(char, g.levels)))];
          return h("td", { class: "num" },
            h("span", { class: "strong" }, fmt(cell.coins)),
            h("span", { class: "sub" }, cell.groups.map((g) => `${fmt(g.perUse)} × ${g.count}회`).join(" + ")),
            ups.length ? h("span", { class: "sub up" }, `${ups.join(", ")} ↑`) : null);
        }),
        h("td", { class: "num strong" }, fmt(row.coins), h("span", { class: "sub" }, `${row.uses}회`)),
        h("td", { class: "num" }, fmt(row.cumulative)),
        h("td", { class: "left-cell" },
          h("span", { class: `left-num${row.remaining < 0 ? " bad" : ""}` }, fmt(row.remaining)),
          h("span", { class: "left-bar", "aria-hidden": "true" },
            h("i", { style: `width:${plan.coins ? Math.max(0, Math.min(100, (row.remaining / plan.coins) * 100)) : 0}%` })))));
    target.replaceChildren(
      h("div", { class: "table-scroll" }, h("table", { class: "grid-table schedule-table" }, h("thead", null, head), h("tbody", null, body))));
  }

  function renderDetails(plan, rows, weeks) {
    const target = $("#details");
    const active = plan.chars.map((c, i) => [c, i]).filter(([c]) => c.uses > 0);
    if (!active.length || !rows.length) {
      target.replaceChildren(h("p", { class: "empty" }, "사용할 캐릭터와 남은 주가 있으면 캐릭터마다 주차별 단계가 여기에 나옵니다."));
      return;
    }
    target.replaceChildren(...active.map(([char, index]) => detailCard(char, index, rows, weeks)));
  }

  function detailCard(char, index, rows, weeks) {
    const source = sourceOf(index);
    const head = h("tr", null,
      h("th", { scope: "col" }, "주차"),
      h("th", { scope: "col", class: "num" }, "횟수"),
      P.STATS.map((s) => h("th", { scope: "col", class: "num" }, s.short)),
      h("th", { scope: "col", class: "num" }, "1회 코인"),
      h("th", { scope: "col", class: "num" }, "주 코인"));
    const body = [];
    for (const row of rows) {
      const cell = row.cells[index];
      cell.groups.forEach((group, g) => {
        const label = weekLabel(weeks, row);
        if (cell.groups.length > 1) label.setAttribute("rowspan", String(cell.groups.length));
        body.push(h("tr", { class: g ? "group-next" : null },
          g ? null : label,
          h("td", { class: "num" }, `${group.count}회`),
          P.STATS.map((s) => {
            const level = group.levels[s.key];
            const fixed = char.stats[s.key].mode === "fixed";
            const up = level > char.stats[s.key].level;
            return h("td", { class: `num stat${fixed ? " is-fixed" : ""}${up ? " is-up" : ""}${level ? "" : " is-off"}` },
              level ? `${level}단계` : "안 씀",
              level ? h("span", { class: "sub" }, P.statText(s.key, level)) : null);
          }),
          h("td", { class: "num" }, fmt(group.perUse)),
          g ? null : h("td", { class: "num strong", rowspan: cell.groups.length > 1 ? String(cell.groups.length) : null }, fmt(cell.coins))));
      });
    }
    const foot = h("tr", null,
      h("th", { scope: "row" }, "합계"),
      h("td", { class: "num" }, `${fmt(char.uses)}회`),
      h("td", { colspan: String(P.STATS.length) }),
      h("td", { class: "num" }),
      h("td", { class: "num strong" }, fmt(char.monthly)));
    const fixedNames = P.STATS.filter((s) => char.stats[s.key].mode === "fixed").map((s) => s.short);
    return h("article", { class: "char-card" },
      h("header", { class: "char-card-head" },
        avatar(source, "lg"),
        h("div", { class: "char-card-title" },
          h("h3", null, nameOf(source)),
          h("span", { class: "char-meta" }, metaText(source)),
          h("span", { class: "char-card-sub" },
            `주 ${char.weekly}회 · 이번 달 ${char.uses}회`,
            fixedNames.length ? ` · 고정 ${fixedNames.join(", ")}` : "")),
        h("div", { class: "char-card-total" }, h("span", null, "이번 달 코인"), h("strong", null, fmt(char.monthly)))),
      h("div", { class: "table-scroll" },
        h("table", { class: "grid-table detail-table" }, h("thead", null, head), h("tbody", null, body), h("tfoot", null, foot))));
  }

  /* ---------- 시작 ---------- */

  renderSetup();
  renderExampleNote();
  renderCharacters();
  renderResults();

  checkImageService().then(() => {
    if (imageService !== "ready" || state.example) return;
    const stale = state.characters.filter((c) => c.name.trim() && (!c.nexon || Date.now() - c.nexon.fetchedAt > NEXON_STALE_MS));
    loadAll(stale);
  });
})();
