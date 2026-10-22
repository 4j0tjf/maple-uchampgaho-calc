/**
 * 유챔 가호 계산기 서버. 화면 파일을 내주고, 캐릭터 이미지를 넥슨 Open API에서 대신 받아 준다.
 * 다른 사이트(maple-market·maple-hunt)와 따로 돈다. 설치할 패키지가 없다(Node 18 이상).
 *
 * 시세 사이트와 같은 도메인의 /gaho 아래에서 연다(19991115.xyz/gaho/). Cloudflare 터널의 경로 규칙이
 * /gaho로 시작하는 요청을 경로 그대로 이 서버로 넘긴다. 화면은 상대 경로로 파일과 API를 부르므로
 * 주소가 /gaho/처럼 /로 끝나야 해서, /gaho와 /는 /gaho/로 보낸다.
 *
 *   GET /gaho/                     화면(index.html, styles.css, app.js, plan.js, icon.svg만 내준다)
 *   GET /gaho/api/status           { nexon: 키가 있는지 }
 *   GET /gaho/api/character?name=  { name, image, level, job, world } 또는 { error: { code, short, message } }
 *
 * 설정은 같은 폴더의 .env(.env.example 참고) 또는 환경 변수: PORT(기본 3300), HOST(기본 127.0.0.1),
 * BASE_PATH(기본 /gaho, 빈 값이면 /에서 연다), NEXON_API_KEY, NEXON_DAILY_LIMIT(기본 300).
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NexonError, createNexon } from "./nexon.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/** 화면 파일만 내준다. .env·서버 코드·.git은 경로를 맞춰도 나가지 않는다. */
const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/plan.js": "plan.js",
  "/icon.svg": "icon.svg",
};
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
/** 화면이 쓰는 곳만 연다. 글꼴은 Google Fonts, 캐릭터 이미지는 넥슨. 막대 너비를 style 속성으로 넣어서 style은 inline을 허용한다. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://open.api.nexon.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** "/gaho", "gaho/", "/gaho/" → "/gaho". 빈 값이나 "/"는 ""(맨 앞에서 연다). */
export function normalizeBasePath(value) {
  const trimmed = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

/** KEY=VALUE 줄만 읽는 작은 .env 해석. 이미 있는 환경 변수는 덮지 않는다. */
export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
  res.end(body);
}
const json = (res, status, value) => send(res, status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, JSON.stringify(value));

/**
 * @param {{nexon: ReturnType<typeof createNexon>, basePath?: string, root?: string, log?: (message: string) => void}} options
 */
export function createAppServer({ nexon, basePath = "/gaho", root = ROOT, log = console.error }) {
  const base = normalizeBasePath(basePath);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { allow: "GET, HEAD" }, "");

      if (base && (url.pathname === base || url.pathname === "/")) return send(res, 302, { location: `${base}/${url.search}` }, "");
      if (base && !url.pathname.startsWith(`${base}/`)) return send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "찾는 페이지가 없습니다.");
      const path = url.pathname.slice(base.length);

      if (path === "/api/status") return json(res, 200, { nexon: nexon.enabled });
      if (path === "/api/character") {
        try {
          return json(res, 200, await nexon.character(url.searchParams.get("name") || ""));
        } catch (error) {
          if (!(error instanceof NexonError)) throw error;
          if (error.status >= 500) log(`[nexon] ${error.code} ${error.message}`);
          return json(res, error.status, { error: { code: error.code, short: error.short, message: error.message } });
        }
      }

      const file = STATIC_FILES[path];
      if (!file) return send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "찾는 페이지가 없습니다.");
      const body = await readFile(join(root, file));
      const headers = { "content-type": TYPES[extname(file)], "cache-control": "no-cache" };
      if (file === "index.html") headers["content-security-policy"] = CSP;
      return send(res, 200, headers, req.method === "HEAD" ? undefined : body);
    } catch (error) {
      log(`[server] ${error?.stack || error}`);
      if (!res.headersSent) json(res, 500, { error: { code: "SERVER", short: "서버 오류", message: "계산기 서버 오류입니다." } });
      else res.end();
    }
  });
}

/** `node server.mjs`로 실행했을 때만 연다(테스트는 createAppServer만 가져다 쓴다). Windows 경로는 대소문자를 가리지 않는다. */
const isEntry = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isEntry) {
  loadEnv(join(ROOT, ".env"));
  const port = Number(process.env.PORT) || 3300;
  const host = process.env.HOST || "127.0.0.1";
  const basePath = normalizeBasePath(process.env.BASE_PATH ?? "/gaho");
  const nexon = createNexon({ apiKey: process.env.NEXON_API_KEY || "", dailyLimit: Number(process.env.NEXON_DAILY_LIMIT) || 300 });
  createAppServer({ nexon, basePath }).listen(port, host, () => {
    console.log(`유챔 가호 계산기: http://${host}:${port}${basePath}/ (넥슨 API 키 ${nexon.enabled ? "있음" : "없음 - 캐릭터 이미지 꺼짐"})`);
  });
}
