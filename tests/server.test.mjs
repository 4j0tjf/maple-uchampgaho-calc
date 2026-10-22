import test from "node:test";
import assert from "node:assert/strict";
import { createNexon, NexonError } from "../nexon.mjs";
import { createAppServer, normalizeBasePath } from "../server.mjs";

/** 넥슨 API 흉내. 부른 경로를 calls에 남긴다. */
function fakeNexon(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ path: pathname.replace("/maplestory/v1", ""), query: Object.fromEntries(searchParams), key: init.headers["x-nxopen-api-key"] });
    const [status, body] = routes(pathname.replace("/maplestory/v1", ""), searchParams);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const okRoutes = (path, params) => {
  if (path === "/id") {
    return params.get("character_name") === "없는캐릭"
      ? [400, { error: { name: "OPENAPI00004", message: "Please input valid parameter" } }]
      : [200, { ocid: `ocid-${params.get("character_name")}` }];
  }
  return [200, { character_name: params.get("ocid").slice(5), world_name: "스카니아", character_class: "아델", character_level: 285, character_image: "https://open.api.nexon.com/static/maplestory/character/look/A" }];
};

test("이름으로 ocid와 기본 정보를 차례로 받고, 다시 물으면 캐시를 쓴다", async () => {
  const { calls, fetchImpl } = fakeNexon(okRoutes);
  const nexon = createNexon({ apiKey: "test_key", fetchImpl, gapMs: 0 });
  const first = await nexon.character(" 아델본캐 ");
  assert.deepEqual(first, { name: "아델본캐", image: "https://open.api.nexon.com/static/maplestory/character/look/A", level: 285, job: "아델", world: "스카니아" });
  assert.deepEqual(calls.map((c) => [c.path, c.key]), [["/id", "test_key"], ["/character/basic", "test_key"]]);
  await nexon.character("아델본캐");
  assert.equal(calls.length, 2);
  assert.equal(nexon.usage().calls, 2);
});

test("넥슨 오류는 상태·짧은 문구로 바꾸고, 실패한 조회는 캐시하지 않는다", async () => {
  const { calls, fetchImpl } = fakeNexon(okRoutes);
  const nexon = createNexon({ apiKey: "test_key", fetchImpl, gapMs: 0 });
  await assert.rejects(nexon.character("없는캐릭"), (error) => error instanceof NexonError && error.status === 404 && error.short === "캐릭터를 찾지 못함");
  await assert.rejects(nexon.character("없는캐릭"));
  assert.equal(calls.length, 2);
});

test("키가 없거나 이름 형식이 틀리면 넥슨을 부르지 않는다", async () => {
  const { calls, fetchImpl } = fakeNexon(okRoutes);
  await assert.rejects(createNexon({ apiKey: "", fetchImpl }).character("아델"), { code: "NO_KEY", status: 503 });
  const nexon = createNexon({ apiKey: "k", fetchImpl, gapMs: 0 });
  await assert.rejects(nexon.character("이름이열세글자보다훨씬긴캐릭터"), { code: "BAD_NAME", status: 400 });
  await assert.rejects(nexon.character("a/../b"), { code: "BAD_NAME" });
  assert.equal(calls.length, 0);
});

test("하루 호출 한도를 넘으면 막고, 한국 날짜가 바뀌면 다시 센다", async () => {
  const { fetchImpl } = fakeNexon(okRoutes);
  let clock = Date.parse("2026-10-21T14:00:00Z"); // 한국 23시
  const nexon = createNexon({ apiKey: "k", fetchImpl, gapMs: 0, dailyLimit: 3, now: () => clock });
  await nexon.character("하나");
  await assert.rejects(nexon.character("둘"), { code: "DAILY_LIMIT", status: 429 });
  clock += 2 * 3600 * 1000; // 한국 다음 날 1시
  await nexon.character("둘");
  assert.deepEqual(nexon.usage(), { day: "2026-10-22", calls: 2, dailyLimit: 3 });
});

async function listen(t, options) {
  const server = createAppServer({ log: () => {}, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("서버는 /gaho 아래에서 화면 파일과 API만 내주고 .env·서버 코드는 내주지 않는다", async (t) => {
  const { fetchImpl } = fakeNexon(okRoutes);
  const origin = await listen(t, { nexon: createNexon({ apiKey: "k", fetchImpl, gapMs: 0 }) });
  const base = `${origin}/gaho`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: https:\/\/open\.api\.nexon\.com/);
  assert.match(await page.text(), /유챔 가호 계산기/);
  assert.equal((await fetch(`${base}/plan.js`)).status, 200);
  for (const path of ["/.env", "/.env.example", "/server.mjs", "/nexon.mjs", "/package.json", "/../README.md", "/%2e%2e/README.md"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  // /gaho 밖의 경로는 시세 사이트 몫이라 내주지 않는다.
  for (const path of ["/plan.js", "/api/status", "/gahoo/", "/hunting/"]) {
    assert.equal((await fetch(`${origin}${path}`, { redirect: "manual" })).status, 404, path);
  }

  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { nexon: true });
  const character = await fetch(`${base}/api/character?name=${encodeURIComponent("아델본캐")}`);
  assert.equal(character.status, 200);
  assert.equal((await character.json()).job, "아델");
  const missing = await fetch(`${base}/api/character?name=${encodeURIComponent("없는캐릭")}`);
  assert.equal(missing.status, 404);
  assert.deepEqual((await missing.json()).error.code, "OPENAPI00004");
  assert.equal((await fetch(`${base}/api/status`, { method: "POST" })).status, 405);
});

test("/gaho와 /는 /gaho/로 보낸다(화면이 상대 경로로 파일을 부르므로 /로 끝나야 한다)", async (t) => {
  const origin = await listen(t, { nexon: createNexon({ apiKey: "" }) });
  for (const [path, location] of [["/gaho", "/gaho/"], ["/gaho?x=1", "/gaho/?x=1"], ["/", "/gaho/"]]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), location, path);
  }
});

test("BASE_PATH를 비우면 맨 앞(/)에서 연다", async (t) => {
  assert.equal(normalizeBasePath(" gaho/ "), "/gaho");
  assert.equal(normalizeBasePath("/"), "");
  const origin = await listen(t, { nexon: createNexon({ apiKey: "" }), basePath: "" });
  assert.equal((await fetch(`${origin}/`)).status, 200);
  assert.deepEqual(await (await fetch(`${origin}/api/status`)).json(), { nexon: false });
});
