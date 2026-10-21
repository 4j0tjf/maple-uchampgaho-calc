/**
 * 넥슨 Open API(메이플스토리) 캐릭터 조회. 서버(server.mjs)에서만 부르고, 키는 서버의 .env에만 둔다.
 * - ocid: GET /maplestory/v1/id?character_name=
 * - 기본: GET /maplestory/v1/character/basic?ocid= → character_image, character_level, character_class, world_name
 *
 * 같은 키를 maple-hunt도 쓰므로 호출을 아낀다. ocid는 7일, 기본 정보는 1시간 캐시하고,
 * 하루 호출 수에 상한(NEXON_DAILY_LIMIT)을 둔다. 호출은 서버 전체에서 한 줄로 세워 초당 5건을 넘지 않게 한다.
 */
export const NEXON_BASE = "https://open.api.nexon.com/maplestory/v1";
const OCID_TTL_MS = 7 * 24 * 3600 * 1000;
const BASIC_TTL_MS = 3600 * 1000;
const GAP_MS = 220;
/** 메이플 캐릭터 이름: 한글·영문·숫자 12자까지. */
const NAME_PATTERN = /^[가-힣A-Za-z0-9]{1,12}$/;

export class NexonError extends Error {
  /**
   * @param {number} status 이 서버가 브라우저에 돌려줄 HTTP 상태
   * @param {string} code 넥슨 오류 코드(OPENAPI…) 또는 이 서버의 코드
   * @param {string} short 캐릭터 이름 아래에 적을 짧은 문구
   * @param {string} message 자세한 안내
   */
  constructor(status, code, short, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.short = short;
  }
}

/** 넥슨 오류 코드 → [브라우저에 돌려줄 상태, 짧은 문구, 안내]. */
const NEXON_ERRORS = {
  OPENAPI00001: [502, "넥슨 서버 오류", "넥슨 API 서버 오류입니다. 잠시 후 다시 시도하세요."],
  OPENAPI00002: [503, "API 키 권한 없음", "넥슨 API 키에 권한이 없습니다. 서버 .env의 NEXON_API_KEY를 확인하세요."],
  OPENAPI00003: [404, "캐릭터를 찾지 못함", "캐릭터 식별자가 올바르지 않습니다. 이름을 바꾼 캐릭터면 새 이름으로 다시 넣으세요."],
  OPENAPI00004: [404, "캐릭터를 찾지 못함", "캐릭터를 찾지 못했습니다. 게임 속 캐릭터 이름과 같은지 확인하세요."],
  OPENAPI00005: [503, "API 키 오류", "넥슨 API 키가 올바르지 않습니다. 서버 .env의 NEXON_API_KEY를 확인하세요."],
  OPENAPI00006: [502, "넥슨 API 오류", "넥슨 API 주소가 바뀌었습니다. 계산기를 업데이트해야 합니다."],
  OPENAPI00007: [429, "호출 한도 초과", "넥슨 API 호출 한도를 넘었습니다. 잠시 후 다시 시도하세요."],
  OPENAPI00009: [503, "데이터 준비 중", "넥슨 API 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요."],
  OPENAPI00010: [503, "게임 점검 중", "게임 점검 중이라 캐릭터 정보를 가져올 수 없습니다."],
  OPENAPI00011: [503, "API 점검 중", "넥슨 API 점검 중이라 캐릭터 정보를 가져올 수 없습니다."],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 한국 날짜(YYYY-MM-DD). 넥슨 API 일일 한도도 한국 날짜로 바뀐다. */
const kstDay = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * @param {{apiKey?: string, dailyLimit?: number, fetchImpl?: typeof fetch, now?: () => number, gapMs?: number}} options
 */
export function createNexon({ apiKey = "", dailyLimit = 300, fetchImpl = fetch, now = Date.now, gapMs = GAP_MS } = {}) {
  /** 이름 → { promise, expires }, ocid → { promise, expires }. 같은 이름을 동시에 물어도 한 번만 부른다. */
  const ocids = new Map();
  const basics = new Map();
  let day = kstDay(now());
  let calls = 0;
  let queue = Promise.resolve();

  function nexonGet(path) {
    const run = queue.then(async () => {
      const today = kstDay(now());
      if (today !== day) {
        day = today;
        calls = 0;
      }
      if (calls >= dailyLimit) {
        throw new NexonError(429, "DAILY_LIMIT", "오늘 한도 초과", `오늘 이 계산기의 넥슨 API 호출 한도(${dailyLimit}건)를 다 썼습니다. 내일 다시 시도하세요.`);
      }
      calls++;
      let response;
      try {
        response = await fetchImpl(`${NEXON_BASE}${path}`, { headers: { "x-nxopen-api-key": apiKey }, signal: AbortSignal.timeout(8000) });
      } catch {
        throw new NexonError(502, "NETWORK", "넥슨 연결 실패", "서버가 넥슨 API에 연결하지 못했습니다. 서버 PC의 인터넷 연결을 확인하세요.");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.name || `HTTP_${response.status}`;
        const [status, short, message] = NEXON_ERRORS[code] || [502, "넥슨 API 오류", `넥슨 API 오류(${code})입니다.`];
        throw new NexonError(status, code, short, message);
      }
      return body;
    });
    queue = run.catch(() => {}).then(() => wait(gapMs));
    return run;
  }

  function cached(map, key, ttl, load) {
    const hit = map.get(key);
    if (hit && hit.expires > now()) return hit.promise;
    const promise = load();
    map.set(key, { promise, expires: now() + ttl });
    promise.catch(() => map.delete(key));
    return promise;
  }

  /**
   * @param {string} rawName
   * @returns {Promise<{name:string, image:string, level:number, job:string, world:string}>}
   */
  async function character(rawName) {
    if (!apiKey) throw new NexonError(503, "NO_KEY", "API 키 없음", "서버 .env에 NEXON_API_KEY가 없습니다. 키를 넣고 서버를 다시 시작하세요.");
    const name = String(rawName ?? "").normalize("NFC").trim();
    if (!NAME_PATTERN.test(name)) throw new NexonError(400, "BAD_NAME", "이름 형식 오류", "캐릭터 이름은 한글·영문·숫자 12자까지입니다.");
    const ocid = await cached(ocids, name, OCID_TTL_MS, async () => (await nexonGet(`/id?character_name=${encodeURIComponent(name)}`)).ocid);
    try {
      return await cached(basics, ocid, BASIC_TTL_MS, async () => {
        const basic = await nexonGet(`/character/basic?ocid=${encodeURIComponent(ocid)}`);
        return {
          name: String(basic.character_name ?? name),
          image: String(basic.character_image ?? ""),
          level: Number(basic.character_level) || 0,
          job: String(basic.character_class ?? ""),
          world: String(basic.world_name ?? ""),
        };
      });
    } catch (error) {
      // 이름을 바꾸거나 지운 캐릭터면 저장해 둔 ocid가 틀렸을 수 있다. 다음에는 ocid부터 다시 찾는다.
      ocids.delete(name);
      throw error;
    }
  }

  return { character, enabled: Boolean(apiKey), usage: () => ({ day, calls, dailyLimit }) };
}
