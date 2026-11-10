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
  /** 지난달 이월 코인은 이번 달 1~7일에만 남는다. 다른 달에 넣은 값은 쓰지 않는다. */
  const monthKey = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const carryOpen = today.day <= P.CARRY_DAYS;
  const prevMonth = today.month === 1 ? 12 : today.month - 1;
  const nextMonth = today.month === 12 ? 1 : today.month + 1;

  const emptyFixed = () => Object.fromEntries(P.STAT_KEYS.map((key) => [key, null]));
  let seq = 0;
  const uid = (prefix = "c") => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

  /**
   * 챔피언 코인은 넥슨 계정(유니온)마다 따로다. 그래서 코인·이월 코인·캐릭터를 넥슨 계정 탭(profile)마다 둔다.
   * state = { version: 2, example, active: 탭 id, profiles: [{ id, name, coins, carry, carryMonth, includeCurrent, characters }] }
   * 캐릭터의 scheduler는 스케줄러에 등록한 같은 캐릭터의 id(스케줄러에서 불러왔을 때).
   */
  const MAX_PROFILES = 20;
  const MAX_CHARACTERS = 60;
  const profileName = (index) => `넥슨 계정 ${index + 1}`;
  const newProfile = (name, characters = []) => ({ id: uid("p"), name, coins: 0, carry: 0, carryMonth: "", includeCurrent: true, characters });
  const newCharacter = (name, extra = {}) => ({ id: uid(), name, weekly: 1, fixed: emptyFixed(), nexon: null, scheduler: null, ...extra });

  function exampleState() {
    const profile = newProfile(profileName(0), [
      newCharacter("본캐", { fixed: { ...emptyFixed(), boss: 5, ied: 5 } }),
      newCharacter("부캐 1"),
      newCharacter("부캐 2"),
    ]);
    profile.coins = 20000;
    return { version: 2, example: true, active: profile.id, profiles: [profile] };
  }

  const intIn = (value, min, max, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const idOf = (value, prefix) => (typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? value : uid(prefix));

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

  function sanitizeCharacter(c) {
    const fixed = emptyFixed();
    for (const key of P.STAT_KEYS) {
      const value = c?.fixed?.[key];
      fixed[key] = value == null ? null : intIn(value, 0, P.MAX_LEVEL, null);
    }
    return {
      id: idOf(c?.id, "c"),
      name: String(c?.name ?? "").slice(0, 20),
      weekly: intIn(c?.weekly, 0, MAX_WEEKLY, 1),
      fixed,
      nexon: sanitizeNexon(c?.nexon),
      scheduler: typeof c?.scheduler === "string" && c.scheduler ? c.scheduler.slice(0, 64) : null,
    };
  }

  function sanitizeProfile(p, index) {
    return {
      id: idOf(p?.id, "p"),
      name: String(p?.name ?? "").trim().slice(0, 20) || profileName(index),
      coins: intIn(p?.coins, 0, 99999999, 0),
      carry: intIn(p?.carry, 0, 99999999, 0),
      carryMonth: typeof p?.carryMonth === "string" ? p.carryMonth.slice(0, 7) : "",
      includeCurrent: p?.includeCurrent !== false,
      characters: Array.isArray(p?.characters) ? p.characters.slice(0, MAX_CHARACTERS).map(sanitizeCharacter) : [],
    };
  }

  /**
   * 저장본이 깨졌거나 옛 형식이어도 화면이 뜨도록 값마다 확인한다.
   * 넥슨 계정 탭이 없던 옛 형식({ coins, characters, … })은 탭 하나("넥슨 계정 1")로 옮긴다.
   */
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const profiles = (Array.isArray(raw.profiles) ? raw.profiles.slice(0, MAX_PROFILES) : [raw]).map(sanitizeProfile);
    if (!profiles.length) profiles.push(newProfile(profileName(0)));
    const seen = new Set();
    for (const p of profiles) {
      if (seen.has(p.id)) p.id = uid("p");
      seen.add(p.id);
    }
    const active = profiles.some((p) => p.id === raw.active) ? raw.active : profiles[0].id;
    return { version: 2, example: Boolean(raw.example), active, profiles };
  }

  /** 스케줄러 계정에 저장하는 값(예시 표시는 뺀다). */
  const exportState = () => ({ version: 2, active: state.active, profiles: state.profiles });

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 저장할 수 없는 브라우저(사생활 보호 창 등)에서는 이번 탭에서만 유지한다. */
    }
  }

  let state = loadLocal() || exampleState();
  /** 지금 보고 있는 넥슨 계정 탭. */
  const cur = () => state.profiles.find((p) => p.id === state.active) || state.profiles[0];
  const ownsCharacter = (c) => state.profiles.some((p) => p.characters.includes(c));

  /* ---------- 스케줄러 계정 (같은 도메인의 /scheduler) ---------- */

  /**
   * 스케줄러에 로그인하면 계산기 값을 그 계정(스케줄러 DB)에 저장하고, 스케줄러에 등록한 캐릭터를 불러오며,
   * 캐릭터 정보는 그 계정에 등록한 넥슨 API 키로 받는다. 세션 쿠키가 /scheduler 아래에만 가므로 화면이 스케줄러 API를 직접 부른다.
   * 로그인 전에는 지금처럼 이 브라우저에 저장하고 계산기 서버의 키로 받는다.
   *
   * status: checking | off(이 주소에서는 스케줄러를 쓸 수 없음) | out(로그인 전) | loading | in
   */
  const scheduler = {
    path: "",
    status: "checking",
    account: null,
    nexon: false,
    characters: [],
    base: null,
    dirty: false,
    inFlight: false,
    again: false,
    timer: 0,
    save: "saved",
    note: "",
    noteBad: false,
  };
  const signedIn = () => scheduler.status === "in";
  const SAVE_DELAY_MS = 800;

  async function schedulerApi(path, init = {}) {
    const headers = typeof init.body === "string" ? { "content-type": "application/json" } : {};
    let response;
    try {
      response = await fetch(`${scheduler.path}${path}`, { cache: "no-store", credentials: "same-origin", ...init, headers });
    } catch {
      throw Object.assign(new Error("스케줄러에 연결하지 못했습니다."), { status: 0 });
    }
    const json = (response.headers.get("content-type") || "").includes("json");
    const body = json ? await response.json().catch(() => null) : null;
    if (!response.ok || !json) {
      const message = body?.error || (response.status === 404 ? "스케줄러에 이 기능이 없습니다. 스케줄러를 업데이트하세요." : `스케줄러 오류(${response.status})입니다.`);
      throw Object.assign(new Error(message), { status: response.ok ? 502 : response.status, body });
    }
    return body;
  }

  /** 스케줄러 캐릭터 → 계산기 캐릭터의 넥슨 정보. */
  const nexonOf = (sc) => sanitizeNexon({ name: sc.name, image: sc.image, level: sc.level, job: sc.className, world: sc.world, fetchedAt: Date.now() });
  const schedulerById = (id) => scheduler.characters.find((sc) => sc.id === id);
  const schedulerByName = (name) => scheduler.characters.find((sc) => sc.name === name.trim());

  /** 계산기 캐릭터를 스케줄러 캐릭터와 잇고 이미지·레벨을 스케줄러 값으로 바꾼다. 스케줄러에서 지운 캐릭터는 연결만 푼다. */
  function linkSchedulerCharacters(target = state) {
    for (const p of target.profiles) {
      for (const c of p.characters) {
        const sc = (c.scheduler && schedulerById(c.scheduler)) || (!c.scheduler && c.name.trim() ? schedulerByName(c.name) : null);
        if (!sc) {
          if (c.scheduler) c.scheduler = null;
          continue;
        }
        c.scheduler = sc.id;
        c.name = sc.name;
        c.nexon = nexonOf(sc) || c.nexon;
      }
    }
  }

  /** 어느 넥슨 계정 탭에도 없는 스케줄러 캐릭터. */
  function unusedSchedulerCharacters(target = state) {
    const ids = new Set();
    const names = new Set();
    for (const p of target.profiles) {
      for (const c of p.characters) {
        if (c.scheduler) ids.add(c.scheduler);
        names.add(c.name.trim());
      }
    }
    return scheduler.characters.filter((sc) => !ids.has(sc.id) && !names.has(sc.name));
  }

  function addSchedulerCharacters(profile, list) {
    for (const sc of list) {
      if (profile.characters.length >= MAX_CHARACTERS) break;
      profile.characters.push(newCharacter(sc.name, { scheduler: sc.id, nexon: nexonOf(sc) }));
    }
  }

  function setNote(text, bad = false) {
    scheduler.note = text;
    scheduler.noteBad = bad;
    renderAccount();
  }

  function setSaveState(value, message = "") {
    scheduler.save = value;
    if (message) setNote(message, value === "error");
    else renderAccount();
  }

  function queueRemoteSave() {
    scheduler.dirty = true;
    setSaveState("saving");
    clearTimeout(scheduler.timer);
    scheduler.timer = setTimeout(() => flushRemote(), SAVE_DELAY_MS);
  }

  /** 바뀐 값을 스케줄러에 저장한다. 한 번에 하나씩 보내고, 보내는 사이 또 바뀌면 끝난 뒤 한 번 더 보낸다. */
  async function flushRemote({ keepalive = false } = {}) {
    clearTimeout(scheduler.timer);
    if (!signedIn() || !scheduler.dirty) return;
    if (scheduler.inFlight) {
      scheduler.again = true;
      return;
    }
    const account = scheduler.account;
    scheduler.dirty = false;
    scheduler.inFlight = true;
    try {
      const body = await schedulerApi("/api/gaho", { method: "PUT", body: JSON.stringify({ state: exportState(), base: scheduler.base }), keepalive });
      if (scheduler.account !== account) return;
      scheduler.base = body.updatedAt;
      setSaveState(scheduler.dirty ? "saving" : "saved");
    } catch (error) {
      if (scheduler.account !== account) return;
      if (error.status === 409 && error.body?.state) {
        adoptRemote(error.body.state, error.body.updatedAt);
        setSaveState("saved", "다른 기기나 창에서 먼저 저장한 값이 있어 그 값으로 바꿨습니다.");
      } else if (error.status === 401) {
        signedOut("스케줄러 로그인이 끝났습니다. 다시 로그인하세요.", true);
      } else {
        scheduler.dirty = true;
        setSaveState("error", `스케줄러에 저장하지 못했습니다. ${error.message}`);
      }
    } finally {
      scheduler.inFlight = false;
      if (scheduler.again) {
        scheduler.again = false;
        flushRemote();
      }
    }
  }

  function adoptRemote(raw, updatedAt) {
    state = sanitize(raw) || sanitize({ profiles: [newProfile(profileName(0))] });
    state.example = false;
    scheduler.base = updatedAt ?? null;
    scheduler.dirty = false;
    linkSchedulerCharacters();
    renderAll();
  }

  /**
   * 로그인한 계정의 값과 스케줄러 캐릭터를 불러온다. 처음이면 이 브라우저에 넣어 둔 값(예시가 아니면)을 첫 넥슨 계정 탭으로 옮기고,
   * 스케줄러에 등록한 캐릭터를 모두 넣어 바로 저장한다.
   */
  async function enterAccount(account) {
    scheduler.status = "loading";
    scheduler.account = account;
    renderAccount();
    try {
      const [saved, list] = await Promise.all([schedulerApi("/api/gaho"), schedulerApi("/api/characters")]);
      if (scheduler.account !== account) return;
      scheduler.characters = (Array.isArray(list?.characters) ? list.characters : [])
        .filter((sc) => sc && typeof sc.id === "string" && typeof sc.name === "string");
      scheduler.nexon = Boolean(list?.nexon);
      scheduler.status = "in";
      if (saved?.state) {
        adoptRemote(saved.state, saved.updatedAt);
        setSaveState("saved", "");
      } else {
        const first = state.example ? sanitize({ profiles: [newProfile(profileName(0))] }) : sanitize(JSON.parse(JSON.stringify(state)));
        first.example = false;
        const moved = !state.example;
        linkSchedulerCharacters(first);
        const added = unusedSchedulerCharacters(first);
        addSchedulerCharacters(first.profiles.find((p) => p.id === first.active) || first.profiles[0], added);
        state = first;
        scheduler.base = null;
        renderAll();
        scheduler.dirty = true;
        setNote([moved ? "이 브라우저에 넣어 둔 값을 스케줄러 계정으로 옮겼습니다." : "", added.length ? `스케줄러에 등록한 캐릭터 ${added.length}명을 넣었습니다.` : ""].filter(Boolean).join(" "));
        await flushRemote();
      }
      refreshStale();
    } catch (error) {
      if (scheduler.account !== account) return;
      Object.assign(scheduler, { status: "out", account: null, characters: [], nexon: false });
      setNote(`스케줄러 계정의 값을 불러오지 못해 이 브라우저에 저장합니다. ${error.message}`, true);
      renderAll();
    }
  }

  function signedOut(message, bad = false) {
    clearTimeout(scheduler.timer);
    Object.assign(scheduler, { status: "out", account: null, characters: [], nexon: false, base: null, dirty: false, save: "saved" });
    state = loadLocal() || exampleState();
    renderAll();
    setNote(message, bad);
  }

  async function login(username, password) {
    const body = await schedulerApi("/api/session", { method: "POST", body: JSON.stringify({ mode: "login", username, password }) });
    if (!body?.account) throw new Error("로그인하지 못했습니다.");
    await enterAccount(body.account);
  }

  async function logout() {
    await flushRemote();
    try {
      await schedulerApi("/api/session", { method: "DELETE" });
    } catch {
      /* 이미 끝난 세션이어도 화면은 로그아웃한다. */
    }
    signedOut("로그아웃했습니다. 스케줄러에서도 로그아웃됩니다. 이 브라우저에 넣어 둔 값으로 돌아왔습니다.");
  }

  // 창을 닫거나 다른 앱으로 옮길 때 아직 못 보낸 값을 보낸다.
  const flushOnLeave = () => {
    if (scheduler.dirty) flushRemote({ keepalive: true });
  };
  window.addEventListener("pagehide", flushOnLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnLeave();
  });

  function save() {
    if (signedIn()) queueRemoteSave();
    else saveLocal();
  }

  /** 사용자가 값을 바꿨다. 예시 표시를 끄고 저장한 뒤 결과를 다시 그린다. */
  function touch() {
    state.example = false;
    save();
    renderExampleNote();
    renderResults();
  }

  const weeksNow = () => P.remainingWeeks(today, cur().includeCurrent);
  const carryNow = () => (carryOpen && cur().carryMonth === monthKey ? cur().carry : 0);
  const md = (d) => `${d.month}/${d.day}`;
  const range = (w) => (w.start.month === w.end.month && w.start.day === w.end.day ? md(w.start) : `${md(w.start)}~${md(w.end)}`);

  /* ---------- 캐릭터 이미지 (넥슨 Open API) ---------- */

  /**
   * 계산기 서버의 키: checking → ready(서버에 넥슨 키가 있음) | no-key | offline(서버 없이 파일로 열었거나 미리보기).
   * 스케줄러에 로그인하면 서버의 키 대신 그 계정에 등록한 키(스케줄러 /api/gaho/character)로 받는다.
   */
  let imageService = "checking";

  /** 캐릭터 정보를 어디서 받을지. 로그인하면 그 계정의 키, 로그인 전에는 계산기 서버의 키. */
  function lookupSource() {
    if (signedIn()) return scheduler.nexon ? "scheduler" : null;
    return imageService === "ready" ? "server" : null;
  }

  /** 계산기 서버 설정(넥슨 키가 있는지, 스케줄러 주소)을 받고, 스케줄러에 로그인돼 있으면 그 계정으로 들어간다. */
  async function checkServices() {
    let status = null;
    try {
      const response = await fetch("api/status", { cache: "no-store" });
      status = response.ok ? await response.json() : null;
    } catch {
      status = null;
    }
    imageService = status ? (status.nexon ? "ready" : "no-key") : "offline";
    scheduler.path = typeof status?.scheduler === "string" ? status.scheduler : "";
    renderImageNote();
    if (!scheduler.path) {
      scheduler.status = "off";
      renderAccount();
      return;
    }
    try {
      const body = await schedulerApi("/api/session");
      if (!body || !("account" in body)) throw new Error();
      if (body.account) await enterAccount(body.account);
      else {
        scheduler.status = "out";
        renderAccount();
      }
    } catch {
      scheduler.status = "off";
      renderAccount();
    }
  }

  const lookupError = (short, message) => Object.assign(new Error(message), { short });

  async function fetchCharacter(name) {
    if (lookupSource() === "scheduler") {
      try {
        return await schedulerApi(`/api/gaho/character?name=${encodeURIComponent(name)}`);
      } catch (error) {
        throw lookupError(error.status === 404 ? "캐릭터를 찾지 못함" : "불러오기 실패", error.message);
      }
    }
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
    if (!name) return;
    // 스케줄러에 등록한 캐릭터면 넥슨을 부르지 않고 스케줄러 값을 쓴다.
    const sc = signedIn() ? (c.scheduler && schedulerById(c.scheduler)) || schedulerByName(name) : null;
    if (sc) {
      c.scheduler = sc.id;
      c.nexon = nexonOf(sc) || c.nexon;
      nexonStatus.delete(c.id);
      save();
      refreshCharacterView(c);
      renderResults();
      return;
    }
    if (!lookupSource()) return;
    nexonStatus.set(c.id, { state: "loading" });
    refreshCharacterView(c);
    try {
      const data = await fetchCharacter(name);
      if (c.name.trim() !== name || !ownsCharacter(c)) return;
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

  /** 하루 지난 캐릭터 정보만 다시 받는다(코디를 바꾸면 이미지 주소가 바뀐다). 스케줄러 캐릭터는 스케줄러 값을 쓴다. */
  function refreshStale() {
    if (state.example || (!lookupSource() && !signedIn())) return;
    const stale = cur().characters.filter((c) => c.name.trim() && !c.scheduler && (!c.nexon || Date.now() - c.nexon.fetchedAt > NEXON_STALE_MS));
    if (lookupSource()) loadAll(stale);
  }

  /** 새로고침: 로그인했으면 스케줄러 캐릭터 목록을 다시 받고, 나머지는 넥슨에서 다시 받는다. */
  async function refreshImages() {
    if (signedIn()) {
      try {
        const list = await schedulerApi("/api/characters");
        scheduler.characters = (Array.isArray(list?.characters) ? list.characters : []).filter((sc) => sc && typeof sc.id === "string" && typeof sc.name === "string");
        scheduler.nexon = Boolean(list?.nexon);
        linkSchedulerCharacters();
        save();
        renderCharacters();
        renderResults();
      } catch (error) {
        setImageMessage(`스케줄러 캐릭터를 불러오지 못했습니다. ${error.message}`, true);
        return;
      }
    }
    loadAll(cur().characters.filter((c) => c.name.trim() && !c.scheduler));
  }

  function imageNote() {
    if (signedIn()) {
      return scheduler.nexon
        ? `캐릭터 이미지·레벨·직업은 스케줄러 계정(${scheduler.account.username})에 등록한 넥슨 API 키로 불러옵니다.`
        : "스케줄러 계정에 넥슨 API 키를 등록하면 캐릭터 이미지가 나옵니다(스케줄러 왼쪽 위 '넥슨 API 키').";
    }
    return {
      checking: "",
      ready: "캐릭터 이미지·레벨·직업은 넥슨 Open API에서 가져옵니다.",
      "no-key": "서버 .env에 NEXON_API_KEY를 넣고 서버를 다시 시작하면 캐릭터 이미지가 나옵니다. 스케줄러에 로그인하면 그 계정의 키로 불러옵니다.",
      offline: "캐릭터 이미지는 계산기 서버(npm start)로 열었을 때 나옵니다.",
    }[imageService];
  }

  function setImageMessage(text, bad = false) {
    const node = $("#image-note-text");
    node.textContent = text;
    node.classList.toggle("bad", bad);
  }

  function renderImageNote() {
    $("#image-note").hidden = imageService === "checking" && !signedIn();
    $("#image-refresh").hidden = !lookupSource() && !signedIn();
    setImageMessage(imageNote());
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

  /** 입력 칸에 이벤트를 한 번 건다. 값은 지금 보고 있는 넥슨 계정 탭(cur())에 넣는다. */
  function bindSetup() {
    const coins = $("#coins");
    coins.addEventListener("input", () => {
      cur().coins = intIn(coins.value.replace(/\D/g, "") || 0, 0, 99999999, 0);
      touch();
    });
    coins.addEventListener("blur", () => {
      coins.value = fmt(cur().coins);
    });

    // 지난달에서 이월된 코인은 1~7일에만 남는다. 그 밖에는 칸을 보여 주되 닫아 둔다.
    $("#carry-label").textContent = `${prevMonth}월에서 이월된 코인`;
    $("#carry-in").classList.toggle("is-closed", !carryOpen);
    const when = $("#carry-in-when");
    when.textContent = carryOpen ? `${today.month}/${P.CARRY_DAYS} 23:59까지` : `${today.month}/${P.CARRY_DAYS}에 끝남`;
    when.classList.toggle("is-open", carryOpen);
    const carry = $("#carry");
    carry.disabled = !carryOpen;
    if (!carryOpen) carry.placeholder = "—";
    carry.addEventListener("input", () => {
      cur().carry = intIn(carry.value.replace(/\D/g, "") || 0, 0, 99999999, 0);
      cur().carryMonth = monthKey;
      touch();
    });
    carry.addEventListener("blur", () => {
      carry.value = fmt(carryNow());
    });
    if (!carryOpen) {
      $("#carry-hint").textContent = `${prevMonth}월 이월 코인은 ${today.month}/${P.CARRY_DAYS} 23:59에 끝났습니다. 이 칸은 매월 1~7일에 씁니다. ${nextMonth}/1~${nextMonth}/${P.CARRY_DAYS}에 열면 게임에 나오는 ${today.month}월 이월 코인을 넣으세요. 그 코인을 ${nextMonth}/${P.CARRY_DAYS}까지 쓰는 주에 먼저 배분합니다.`;
    }

    const include = $("#include-current");
    include.addEventListener("change", () => {
      cur().includeCurrent = include.checked;
      touch();
    });

    $("#add-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#new-name");
      const list = cur().characters;
      if (list.length >= MAX_CHARACTERS) return setImageMessage(`넥슨 계정 하나에 캐릭터는 ${MAX_CHARACTERS}명까지 넣을 수 있습니다.`, true);
      const typed = input.value.trim().slice(0, 20);
      const c = newCharacter(typed || `캐릭터 ${list.length + 1}`);
      list.push(c);
      input.value = "";
      renderCharacters();
      touch();
      if (typed) loadCharacter(c);
    });

    $("#clear-example").addEventListener("click", () => {
      Object.assign(cur(), { coins: 0, carry: 0, characters: [] });
      syncSetup();
      renderCharacters();
      touch();
      $("#coins").focus();
    });

    $("#image-refresh").addEventListener("click", () => refreshImages());

    $("#picker-all").addEventListener("click", () => {
      addSchedulerCharacters(cur(), unusedSchedulerCharacters());
      renderCharacters();
      touch();
    });

    bindAccount();
  }

  /** 넥슨 계정 탭을 바꾸거나 값을 새로 불러오면 입력 칸을 그 탭의 값으로 채운다. */
  function syncSetup() {
    $("#coins").value = fmt(cur().coins);
    $("#carry").value = carryOpen ? fmt(carryNow()) : "";
    $("#include-current").checked = cur().includeCurrent;
  }

  /* ---------- 스케줄러 계정 · 넥슨 계정 탭 ---------- */

  function bindAccount() {
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#login-form button[type=submit]");
      const username = $("#login-id").value.trim();
      const password = $("#login-password").value;
      if (!username || !password) return;
      button.disabled = true;
      setNote("로그인하는 중입니다.");
      try {
        await login(username, password);
        $("#login-password").value = "";
      } catch (error) {
        setNote(error.message || "로그인하지 못했습니다.", true);
      } finally {
        button.disabled = false;
      }
    });
    $("#logout").addEventListener("click", () => logout());
    $("#save-retry").addEventListener("click", () => {
      scheduler.dirty = true;
      flushRemote();
    });

    $("#profile-add").addEventListener("click", () => {
      if (state.profiles.length >= MAX_PROFILES) return;
      const profile = newProfile(profileName(state.profiles.length));
      state.profiles.push(profile);
      state.active = profile.id;
      state.example = false;
      save();
      renderAll();
      $("#profile-name").select();
    });
    const name = $("#profile-name");
    name.addEventListener("input", () => {
      cur().name = name.value.slice(0, 20);
      save();
      renderTabs();
    });
    name.addEventListener("blur", () => {
      if (!cur().name.trim()) {
        cur().name = profileName(state.profiles.indexOf(cur()));
        save();
      }
      renderTabs();
    });
    $("#profile-delete").addEventListener("click", () => {
      const profile = cur();
      if (state.profiles.length <= 1) return;
      const count = profile.characters.length;
      if (!window.confirm(`'${profile.name}' 넥슨 계정${count ? `과 캐릭터 ${count}명` : ""}을 지울까요?`)) return;
      state.profiles = state.profiles.filter((p) => p !== profile);
      state.active = state.profiles[0].id;
      state.example = false;
      save();
      renderAll();
    });
  }

  function renderAccount() {
    const status = scheduler.status;
    const node = $("#account-status");
    const form = $("#login-form");
    form.hidden = status !== "out";
    $("#logout").hidden = status !== "in";
    $("#save-retry").hidden = !(status === "in" && scheduler.save === "error");
    const link = $("#scheduler-link");
    link.hidden = !scheduler.path || status === "off" || status === "checking";
    if (scheduler.path) link.href = `${scheduler.path}/`;
    let text;
    if (status === "checking") text = "확인하는 중…";
    else if (status === "off") text = "이 주소에서는 쓸 수 없음 · 이 브라우저에 저장";
    else if (status === "out") text = "로그인 전 · 이 브라우저에 저장";
    else if (status === "loading") text = `${scheduler.account.username} · 불러오는 중…`;
    else text = `${scheduler.account.username} · ${{ saved: "스케줄러에 저장됨", saving: "저장하는 중…", error: "저장 실패" }[scheduler.save]}`;
    node.textContent = text;
    node.classList.toggle("bad", status === "in" && scheduler.save === "error");
    const hint = $("#account-hint");
    const base = {
      off: "스케줄러 로그인은 스케줄러와 같은 주소(예: 19991115.xyz/gaho/)로 열었을 때 쓸 수 있습니다.",
      out: "스케줄러 계정으로 로그인하면 넥슨 계정별 값을 그 계정에 저장해 어느 기기에서나 이어 쓰고, 스케줄러에 등록한 캐릭터와 그 계정의 넥슨 API 키를 씁니다.",
      in: "값은 스케줄러 계정에 저장됩니다. 로그아웃하면 스케줄러에서도 로그아웃됩니다.",
    }[status] || "";
    hint.textContent = scheduler.note || base;
    hint.classList.toggle("bad", scheduler.noteBad);
    renderImageNote();
  }

  function renderTabs() {
    const active = cur();
    $("#profile-tabs").replaceChildren(...state.profiles.map((p) =>
      h("button", {
        type: "button",
        role: "tab",
        class: `profile-tab${p === active ? " is-active" : ""}`,
        "aria-selected": p === active ? "true" : "false",
        onclick: () => {
          if (p === cur()) return;
          state.active = p.id;
          save();
          renderAll();
        },
      }, p.name.trim() || "이름 없음", h("span", { class: "profile-count" }, `${p.characters.length}명`))));
    $("#profile-add").disabled = state.profiles.length >= MAX_PROFILES;
    const name = $("#profile-name");
    if (document.activeElement !== name) name.value = active.name;
    $("#profile-delete").disabled = state.profiles.length <= 1;
  }

  /** 로그인했을 때: 어느 넥슨 계정 탭에도 없는 스케줄러 캐릭터를 골라 넣는다. */
  function renderPicker() {
    const box = $("#scheduler-picker");
    box.hidden = !signedIn();
    if (!signedIn()) return;
    const unused = unusedSchedulerCharacters();
    $("#picker-all").hidden = unused.length < 2;
    $("#picker-list").replaceChildren(...unused.map((sc) => {
      const view = { name: sc.name, nexon: nexonOf(sc) };
      return h("li", null,
        h("button", {
          type: "button",
          class: "picker-item",
          title: `${sc.name} 추가`,
          onclick: () => {
            if (cur().characters.length >= MAX_CHARACTERS) return;
            addSchedulerCharacters(cur(), [sc]);
            renderCharacters();
            touch();
          },
        }, avatar(view, "xs"), h("span", null, sc.name), sc.level ? h("span", { class: "picker-level" }, `Lv.${sc.level}`) : null, h("span", { class: "picker-add" }, "+ 추가")));
    }));
    $("#picker-hint").textContent = !scheduler.characters.length
      ? "스케줄러에 등록한 캐릭터가 없습니다. 스케줄러의 주간 보스 탭에서 캐릭터를 등록하면 여기에 나옵니다."
      : unused.length
        ? "스케줄러에 등록한 캐릭터 중 어느 넥슨 계정 탭에도 없는 캐릭터입니다. 누르면 지금 탭에 넣습니다. 탭에서 지운 캐릭터는 다시 여기에 나옵니다."
        : "스케줄러에 등록한 캐릭터를 모두 넣었습니다. 탭에서 지우면 다시 여기에 나옵니다.";
  }

  /** 상태를 통째로 바꿨을 때(탭 전환·로그인·로그아웃) 화면 전체를 다시 그린다. */
  function renderAll() {
    nexonStatus.clear();
    renderTabs();
    syncSetup();
    renderExampleNote();
    renderCharacters();
    renderAccount();
    renderResults();
  }

  function renderWeeks(plan) {
    const all = P.remainingWeeks(today, true);
    const used = weeksNow();
    const current = all.weeks[0];
    const deadline = all.deadline;
    $("#today-label").textContent = `오늘 ${today.month}월 ${today.day}일(${WEEKDAYS[today.weekday]}) 기준 ${deadline.month}월 ${deadline.day}일(이월 기한)까지 남은 주`;
    $("#weeks-count").textContent = `${used.weeks.length}주`;
    $("#week-chips").replaceChildren(...all.weeks.map((w) => {
      const off = w.current && !cur().includeCurrent;
      const tag = w.current ? (off ? "빼고 계산" : "이번 주") : w.nextMonth ? "이월" : null;
      return h("li", { class: `week-chip${w.current ? " is-current" : ""}${off ? " is-off" : ""}` },
        range(w),
        tag ? h("span", { class: "week-tag" }, tag) : null);
    }));
    $("#include-current-label").textContent = `이번 주(${range(current)})에도 쓸 수 있음`;
    if (carryOpen) renderCarryHint(plan, used);
  }

  /**
   * 다음 달로 이월 예정 코인: 이번 달 마지막 날까지 쓰고 남는 이번 달 코인.
   * 다음 달에 걸친 주는 시작하는 날(목요일)에 쓴다고 보고 이번 달로 센다.
   */
  function renderCarryOut(plan, rows, weeks) {
    const days = weeks.days;
    $("#carry-out-label").textContent = `${nextMonth}월로 이월 예정 코인`;
    $("#carry-out-when").textContent = `${nextMonth}/1 0시 이월 · ${nextMonth}/${P.CARRY_DAYS}까지`;
    const value = $("#carry-out-value");
    const lines = $("#carry-out-lines");
    if (!plan.totalUses) {
      value.textContent = "—";
      lines.replaceChildren(h("li", null, "캐릭터와 주간 사용 횟수를 넣으면 이번 달에 쓰고 남는 코인을 계산합니다."));
      return;
    }
    const out = P.carryOver(plan, rows, weeks.weeks);
    value.textContent = fmt(out.coins);
    const later = weeks.weeks.filter((w) => w.nextMonth).map(range);
    const straddle = weeks.weeks.findIndex((w) => !w.nextMonth && w.end.month !== today.month);
    const items = [
      h("li", null, `${today.month}/${days}까지 이번 달 코인 `, h("b", null, fmt(out.spent)), " 쓰고 남는 코인", plan.carry ? ` (${prevMonth}월 이월 코인 제외)` : ""),
    ];
    if (plan.shortfall) items.push(h("li", { class: "bad" }, "고정 단계가 코인을 넘어 이월할 코인이 모자랍니다."));
    else if (out.used) items.push(h("li", null, `${later.join(", ")}에 `, h("b", null, fmt(out.used)), " 먼저 씀"));
    if (out.lost) items.push(h("li", { class: "bad" }, h("b", null, fmt(out.lost)), `은 ${nextMonth}/${P.CARRY_DAYS}까지 못 써서 사라짐`));
    if (straddle >= 0 && rows[straddle]?.coins) {
      items.push(h("li", null, `${range(weeks.weeks[straddle])} 주를 ${nextMonth}/1 이후에 쓰면 그 사용분(`, h("b", null, fmt(rows[straddle].coins)), ")만큼 더 이월"));
    }
    lines.replaceChildren(...items);
  }

  /** 지난달 이월 코인 안내: 언제까지, 어느 주에 먼저 쓰는지, 사라지는 코인. */
  function renderCarryHint(plan, weeks) {
    const end = `${today.month}/${P.CARRY_DAYS}`;
    const hint = $("#carry-hint");
    const windowWeeks = weeks.weeks.filter((w) => w.carryIn);
    // 기한(7일) 뒤로 넘어가는 주는 7일까지만 적는다.
    const names = windowWeeks.map((w) => range({ start: w.start, end: w.end.day > P.CARRY_DAYS ? { month: today.month, day: P.CARRY_DAYS } : w.end }));
    let text = `${prevMonth}월에 쓰고 남은 코인(게임에서는 이번 달 코인보다 먼저 빠짐). ${end} 23:59까지만 쓸 수 있어 `;
    text += windowWeeks.length ? `${names.join(", ")}에 쓰는 회차에 먼저 배분합니다.` : "이번 주를 빼면 쓸 주가 없습니다. 이번 주에도 쓸 수 있음을 켜세요.";
    if (plan.carryLost) text += ` ${fmt(plan.carryLost)}코인은 다 쓰지 못해 사라집니다.`;
    hint.textContent = text;
    hint.classList.toggle("bad", plan.carryLost > 0);
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
    renderPicker();
    renderTabs();
    if (!cur().characters.length) {
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
    for (const c of cur().characters) {
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
        // 이름이 바뀌면 예전 이미지·스케줄러 연결은 다른 캐릭터의 것이다.
        if (c.scheduler && schedulerById(c.scheduler)?.name !== c.name.trim()) c.scheduler = null;
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
        cur().characters = cur().characters.filter((x) => x !== c);
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
    const plan = P.buildPlan({
      coins: cur().coins,
      carry: carryNow(),
      carryWeeks: weeks.carryWeeks,
      weeks: weeks.weeks.length,
      characters: cur().characters,
    });
    const rows = P.buildSchedule(plan);
    renderWeeks(plan);
    renderStatus(plan);
    renderSummary(plan, weeks);
    renderPlanTable(plan);
    renderNext(plan);
    renderCarryOut(plan, rows, weeks);
    renderSchedule(plan, rows, weeks);
    renderDetails(plan, rows, weeks);
  }

  const activeChars = (plan) => plan.chars.filter((c) => c.uses > 0);
  /** 화면 상태(state)의 캐릭터. plan.chars와 순서가 같다. */
  const sourceOf = (index) => cur().characters[index];

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
    } else if (plan.carryLost) {
      tone = "bad";
      text = `이월 코인 ${fmt(plan.carryLost)}개 사라짐`;
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

  function renderSummary(plan, weeks) {
    const pool = plan.coins + plan.carry;
    const base = Math.max(pool, plan.used) || 1;
    const pct = (n) => `${(Math.max(0, n) / base) * 100}%`;
    const over = plan.leftover < 0;
    const left = pool - plan.used;
    const until = `${md(weeks.deadline)}까지 ${plan.weeks}주`;
    const tiles = [
      plan.carry
        ? { label: "쓸 수 있는 코인", value: fmt(pool), sub: `이번 달 ${fmt(plan.coins)} · ${prevMonth}월 이월 ${fmt(plan.carry)} · ${until}` }
        : { label: "이번 달 코인", value: fmt(plan.coins), sub: until },
      { label: "쓰는 코인", value: fmt(plan.used), sub: `고정 ${fmt(plan.fixedCoins)} · 자동 ${fmt(plan.autoCoins)}` },
      over
        ? { label: "모자란 코인", value: fmt(-plan.leftover), sub: "고정 단계를 낮추거나 횟수를 줄이세요", tone: "bad" }
        : plan.carryLost
          ? { label: "남는 코인", value: fmt(left), sub: `${prevMonth}월 이월 ${fmt(plan.carryLost)}은 ${today.month}/${P.CARRY_DAYS}에 사라짐`, tone: "bad" }
          : { label: "남는 코인", value: fmt(plan.leftover), sub: plan.leftover && !plan.maxed && plan.autoSlots ? "한 단계를 더 올리기엔 모자람" : "" },
      { label: "사용 횟수", value: `${fmt(plan.totalUses)}회`, sub: `캐릭터 ${activeChars(plan).length}명` },
    ];
    $("#summary").replaceChildren(
      h("div", { class: "tiles" }, tiles.map((t) =>
        h("div", { class: `tile${t.tone ? ` tile-${t.tone}` : ""}` },
          h("span", { class: "tile-label" }, t.label),
          h("span", { class: "tile-value" }, t.value),
          t.sub ? h("span", { class: "tile-sub" }, t.sub) : null))),
      h("div", { class: "coin-bar", role: "img", "aria-label": `쓸 수 있는 코인 ${fmt(pool)} 중 고정 ${fmt(plan.fixedCoins)}, 자동 ${fmt(plan.autoCoins)}, 남음 ${fmt(Math.max(0, left))}` },
        h("span", { class: "seg seg-fixed", style: `width:${pct(plan.fixedCoins)}` }),
        h("span", { class: "seg seg-auto", style: `width:${pct(plan.autoCoins)}` }),
        h("span", { class: "seg seg-left", style: `width:${pct(left)}` }),
        over ? h("span", { class: "seg-limit", style: `left:${pct(pool)}` }) : null),
      h("div", { class: "legend" },
        h("span", null, h("i", { class: "sw sw-fixed" }), "고정"),
        h("span", null, h("i", { class: "sw sw-auto" }), "자동 배분"),
        h("span", null, h("i", { class: "sw sw-left" }), "남음"),
        over ? h("span", null, h("i", { class: "sw sw-limit" }), "이번 달 코인 한도") : null),
    );
  }

  /** 이번 달에 쓰는 가장 높은 단계. */
  const topLevel = (stat) => stat.counts.reduce((top, n, level) => (n > 0 ? level : top), stat.level);

  function pips(stat) {
    const top = topLevel(stat);
    return h("span", { class: `pips${stat.mode === "fixed" ? " pips-fixed" : ""}`, "aria-hidden": "true" },
      [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= stat.level ? "on" : i <= top ? "half" : null })));
  }

  /** 월간 플랜 칸. 위 단계로 쓰는 횟수가 있으면 "2~3단계"와 단계별 횟수를 함께 적는다. */
  function levelCell(stat) {
    const top = topLevel(stat);
    const off = top === 0;
    const label = off ? "안 씀" : top > stat.level ? `${stat.level}~${top}단계` : `${stat.level}단계`;
    const present = stat.counts.map((n, level) => [level, n]).filter(([, n]) => n > 0).reverse();
    const split = present.length > 1 ? present.map(([level, n]) => `${level ? `${level}단계` : "안 씀"} ${n}회`).join(" · ") : null;
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
        P.STATS.map((s) => levelCell(c.stats[s.key])),
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
    if (plan.carryLost && !plan.shortfall) {
      target.textContent = plan.carryWeeks
        ? `${prevMonth}월 이월 코인을 ${today.month}/${P.CARRY_DAYS}까지 쓰는 주에 모두 5단계로 써도 ${fmt(plan.carryLost)}코인이 남아 사라집니다. 그 주의 주간 사용 횟수를 늘리거나 캐릭터를 추가하면 더 쓸 수 있습니다.`
        : `이번 주를 빼서 ${prevMonth}월 이월 코인 ${fmt(plan.carryLost)}개를 쓸 주가 없습니다. ${today.month}/${P.CARRY_DAYS}까지 쓸 수 있으면 이번 주에도 쓸 수 있음을 켜세요.`;
    } else if (plan.shortfall) {
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

  /** 그 주에 기본 단계보다 위로 쓰는 능력치. "보뎀 5단계". */
  const upgradesOf = (char, levels) => P.STAT_KEYS.filter((key) => levels[key] > char.stats[key].level).map((key) => `${statOf(key).short} ${levels[key]}단계`);

  function weekLabel(weeks, row) {
    const w = weeks.weeks[row.week - 1];
    return h("th", { scope: "row", class: "week-cell" },
      h("span", { class: "week-name" }, `${row.week}주차`),
      h("span", { class: "week-range" }, range(w)),
      w.current ? h("span", { class: "week-tag" }, "이번 주") : w.nextMonth ? h("span", { class: "week-tag" }, "이월") : null);
  }

  function renderSchedule(plan, rows, weeks) {
    const target = $("#schedule");
    const pool = plan.coins + plan.carry;
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
            h("i", { style: `width:${pool ? Math.max(0, Math.min(100, (row.remaining / pool) * 100)) : 0}%` })),
          row.carryExpired
            ? h("span", { class: "sub bad" }, `${prevMonth}월 이월 ${fmt(row.carryExpired)} 사라짐`)
            : row.carryLeft ? h("span", { class: "sub" }, `${prevMonth}월 이월 ${fmt(row.carryLeft)} 포함`) : null)));
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

  bindSetup();
  renderAll();

  checkServices().then(() => {
    if (!signedIn()) refreshStale();
  });
})();
