# 유챔 가호 계산기

이번 달 획득 챔피언 코인으로 캐릭터별 **챔피언의 가호** 단계를 정하고, 오늘부터 이번 달 끝까지 주차별로 몇 단계씩 쓸지 보여 준다. 추가 경험치를 뺀 다섯 능력치(올스탯, 공격력/마력, 보스 몬스터 데미지, 방어율 무시, 크리티컬 데미지)만 계산한다.

시세 사이트(maple-market)·사냥 기록(maple-hunt)·maple-Scheduler와 **따로 도는 별도 앱**이다. 포트, Windows 서비스, `.env`가 따로이고 DB와 상단 메뉴를 같이 쓰지 않는다. 주소만 시세 사이트와 같은 도메인의 **/gaho** 아래를 쓴다(`https://19991115.xyz/gaho/`).

| | |
|---|---|
| 주소 | 외부 `https://19991115.xyz/gaho/` · 서버 PC 안 `http://127.0.0.1:3400/gaho/` (`/gaho`와 `/`는 `/gaho/`로 보낸다) |
| 서버 | `node server.mjs` → `127.0.0.1:3400` (Node 18 이상, 설치할 패키지 없음) |
| 서비스 | `MapleGahoWeb` (NSSM) |
| 설정 | `.env` (`.env.example` 복사): `HOST`, `PORT`, `BASE_PATH`(기본 `/gaho`), `NEXON_API_KEY`, `NEXON_DAILY_LIMIT` |
| 외부 연결 | 기존 Cloudflare 터널(`MapleTunnel`)에 `/gaho` 경로 규칙 하나를 더한다(사냥 기록의 `/hunting`과 같은 방식) |
| 저장 | 입력값은 브라우저의 `localStorage`(`uchamp-gaho:v1`)에만 남는다. 주소(출처)마다 따로라 `127.0.0.1:3400`과 `19991115.xyz`의 입력값은 서로 다르다. `19991115.xyz`에서는 시세 사이트와 같은 저장소를 쓰지만 키 이름이 겹치지 않는다. |
| 테스트 | `npm test` |

## 서버 PC에 설치 (Windows, 한 번만)

1. 받기와 설정. 폴더는 다른 사이트 옆에 둔다.

   ```powershell
   git clone -b claude/modest-fermi-b4mhaf https://github.com/4j0tjf/maple-uchampgaho-calc C:\Development\maple-uchampgaho-calc
   cd C:\Development\maple-uchampgaho-calc
   Copy-Item .env.example .env
   notepad .env
   ```

   `.env`의 `NEXON_API_KEY`에 넥슨 Open API 키를 넣는다. maple-hunt의 `.env`와 같은 키를 써도 된다. 비워 두면 계산은 되고 캐릭터 이미지만 꺼진다.

2. 포트 확인과 시험 실행. 3000은 maple-market, 3200·3201은 maple-hunt, 3300은 maple-Scheduler가 쓴다. 첫 줄이 아무것도 출력하지 않으면 3400이 비어 있다(쓰는 중이면 `.env`의 `PORT`를 바꾸고, 아래 터널 규칙의 포트도 같이 바꾼다).

   ```powershell
   Get-NetTCPConnection -LocalPort 3400 -ErrorAction SilentlyContinue
   npm test
   node server.mjs
   ```

   `http://127.0.0.1:3400/gaho/`를 열어 보고 `Ctrl+C`로 끈다. 콘솔에 "넥슨 API 키 있음"이 나와야 이미지가 나온다.

3. 서비스 등록 — 관리자 PowerShell. maple-hunt와 같은 NSSM으로 `node server.mjs`를 바로 부른다. `nssm.exe` 위치는 PC마다 달라서, 이미 NSSM으로 등록한 서비스(MapleHuntWeb 등)가 쓰는 것을 먼저 찾고, 없으면 PATH와 winget 설치 폴더에서 찾는다.

   ```powershell
   $nssm = $null
   foreach ($svc in Get-CimInstance Win32_Service) { if ($svc.PathName -match '"?([^"]*nssm\.exe)') { $nssm = $Matches[1]; break } }
   if (-not $nssm) { $nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source }
   if (-not $nssm) { $nssm = Get-ChildItem "C:\Users\*\AppData\Local\Microsoft\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue | Sort-Object { $_.FullName -notmatch 'win64' } | Select-Object -First 1 -ExpandProperty FullName }
   if (-not $nssm) { throw "nssm.exe를 찾지 못했습니다. winget install --id NSSM.NSSM -e 로 설치하고 PowerShell을 새로 연 뒤 다시 실행하세요." }
   "NSSM: $nssm"
   $node = (Get-Command node).Source
   $root = "C:\Development\maple-uchampgaho-calc"
   New-Item -ItemType Directory -Force "$root\logs" | Out-Null
   & $nssm install MapleGahoWeb $node "$root\server.mjs"
   & $nssm set MapleGahoWeb AppDirectory $root
   & $nssm set MapleGahoWeb AppStdout "$root\logs\web.log"
   & $nssm set MapleGahoWeb AppStderr "$root\logs\web.log"
   & $nssm start MapleGahoWeb
   ```

   마지막 줄에 `Unexpected status SERVICE_PAUSED`가 나오면 서버가 켜지자마자 꺼진 것이다(NSSM은 곧바로 꺼지는 서비스를 "일시 중지됨"으로 둔다). `Get-Content "$root\logs\web.log" -Tail 20`으로 이유를 본다. 흔한 경우는 2단계에서 시험으로 띄운 `node server.mjs`가 아직 3400을 쓰고 있는 것이다(`포트 3400을 다른 프로그램이 쓰고 있습니다`). 그 창을 `Ctrl+C`로 끄고 `Stop-Service MapleGahoWeb; Start-Service MapleGahoWeb`.

4. 밖에서 열기 — 기존 터널(`MapleTunnel`)에 `/gaho` 경로 규칙을 더한다. `C:\Users\user\.cloudflared\config.yml`의 전체 규칙(`service: http://127.0.0.1:3000`) **위에** 넣고(사냥 기록의 `/hunting` 규칙 옆) `Restart-Service MapleTunnel`. DNS는 이미 있는 `19991115.xyz`를 그대로 쓴다.

   ```yaml
     - hostname: 19991115.xyz
       path: ^/gaho(/.*)?$
       service: http://127.0.0.1:3400
   ```

   터널은 경로를 그대로 넘기고, 이 서버가 `/gaho` 아래만 받는다. 규칙이 전체 규칙보다 아래에 있으면 요청이 시세 사이트로 가서 404가 난다. 예전 안내대로 `gaho.19991115.xyz` 규칙이나 DNS를 만들었다면 지워도 된다.

   주소를 아는 사람은 누구나 열 수 있다. 넥슨 키는 서버에만 있고 화면에는 나가지 않는다. 남이 캐릭터 조회를 많이 눌러도 하루 `NEXON_DAILY_LIMIT`(기본 300건)에서 멈춰 maple-hunt가 쓸 몫이 남는다.

   터널 없이 같은 공유기의 다른 기기에서만 열려면 `.env`를 `HOST=0.0.0.0`으로 바꾸고 방화벽을 연다: `New-NetFirewallRule -DisplayName "MapleGaho 3400" -Direction Inbound -Protocol TCP -LocalPort 3400 -Action Allow -Profile Private`, 그다음 `Restart-Service MapleGahoWeb`. 주소는 `http://<서버 PC IP>:3400/gaho/`.

## 코드를 고친 뒤 적용

빌드가 없다. 받고 서비스만 다시 시작한다. `.env`를 고쳤을 때도 다시 시작한다.

```powershell
cd C:\Development\maple-uchampgaho-calc
git pull
Restart-Service MapleGahoWeb
```

점검: `Invoke-RestMethod http://127.0.0.1:3400/gaho/api/status`가 `nexon : True`면 이미지 조회가 켜져 있다. 오류는 `logs\web.log`에 남는다.

## 화면

1. **이번 달 획득 코인**: 이번 달 남은 주 동안 쓸 코인을 넣는다. 주 수는 오늘(한국 시간) 기준으로 자동 계산한다. 이번 주를 이미 썼으면 "이번 주에도 쓸 수 있음"을 끈다.
2. **캐릭터 / 캐릭터 추가**: 이름을 넣고 추가하면 넥슨 캐릭터 이미지·레벨·직업·월드가 붙는다. 주간 사용 횟수는 기본 1이고 위 화살표 +1, 아래 화살표 −1(입력 칸에서 키보드 ↑↓도 같다). 능력치 칸에서 단계를 고르면 그 능력치를 매번 그 단계로 쓴다(고정, **한 번에**로 다섯 칸을 함께 바꾼다). **안 씀**은 0단계 고정, **자동**은 계산기가 정한다.
3. **월간 플랜**: 캐릭터별 단계, 1회 코인, 이번 달 코인. 한 단계 위로 쓰는 횟수가 있으면 "4~5단계 · 5단계 5회 · 4단계 1회"처럼 적는다.
4. **주차별 사용**: 주마다 캐릭터별 코인(1회 코인 × 횟수), 한 단계 위로 쓰는 능력치, 주 합계, 누적, 남은 코인.
5. **주차별 캐릭터 상세 사용**: 캐릭터마다 주차 × 능력치 표로 몇 단계(+수치)를 쓰는지. 한 주 안에서 단계가 갈리면 줄을 나눈다.

## 서버와 넥슨 Open API

- 모든 경로는 `BASE_PATH`(기본 `/gaho`) 아래다. 화면은 파일과 API를 상대 경로로 부르므로 주소가 `/gaho/`처럼 `/`로 끝나야 한다. 그래서 `/gaho`와 `/`는 `/gaho/`로 보내고, `/gaho` 밖의 경로는 404다.
- `GET /gaho/` 화면 파일(`index.html`, `styles.css`, `app.js`, `plan.js`, `icon.svg`)만 내준다. `.env`·서버 코드는 경로를 맞춰도 404다.
- `GET /gaho/api/status` → `{ nexon }`: 서버에 키가 있는지. 화면은 이것으로 이미지 조회를 켜고 끈다.
- `GET /gaho/api/character?name=` → `{ name, image, level, job, world }`. 서버가 넥슨 `GET /maplestory/v1/id?character_name=`로 ocid를, `GET /maplestory/v1/character/basic?ocid=`로 기본 정보를 받는다(헤더 `x-nxopen-api-key`). 실패하면 `{ error: { code, short, message } }`.
- 호출을 아낀다: ocid 7일, 기본 정보 1시간 캐시. 서버 전체에서 한 줄로 세워 초당 5건을 넘지 않는다. 하루(한국 날짜) `NEXON_DAILY_LIMIT`건을 넘으면 막는다. 캐릭터 1명 조회에 2건 든다.
- 화면은 캐릭터를 추가하거나 이름을 고칠 때, "캐릭터 이미지 새로고침"을 누를 때, 페이지를 열었을 때 하루 넘은 정보만 다시 부른다(코디를 바꾸면 이미지 주소가 바뀐다).
- `index.html`을 서버 없이 파일로 열어도 계산은 된다. 이미지만 나오지 않는다.

## 파일

- `server.mjs`: 화면 파일과 `/api/*`. `nexon.mjs`: 넥슨 조회(캐시, 줄 세우기, 하루 한도).
- `plan.js`: 계산(배분, 사용 회차별 단계, 주차별 계획, 남은 주). 화면과 테스트가 함께 쓴다. 모듈이 아닌 일반 스크립트로 `window.GahoPlan`에 붙는다.
- `app.js`: 화면. `styles.css`: maple-market·maple-hunt와 같은 라이트·다크 토큰(시스템 테마를 따른다).
- `tests/plan.test.js`: 계산 테스트. `tests/server.test.mjs`: 서버·넥슨 조회 테스트(넥슨은 흉내 낸 응답).

## 계산

수치 출처: [메이플스토리 공식 가이드 「유니온 챔피언이란?」](https://maplestory.nexon.com/Guide/N23GameInformation/Articles/409), [나무위키 「유니온 챔피언」](https://namu.wiki/w/%EC%9C%A0%EB%8B%88%EC%98%A8%20%EC%B1%94%ED%94%BC%EC%96%B8) (2026-10 확인). 패치로 바뀌면 `plan.js`의 `LEVEL_COST`와 `STATS`만 고친다.

| 단계 | 1회 코인 | 앞 단계보다 | 올스탯 | 공/마 | 보뎀 | 방무 | 크뎀 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | +50 | +10 | +5 | +2% | +2% | +0.5% |
| 2 | 125 | +75 | +20 | +10 | +4% | +4% | +1% |
| 3 | 200 | +75 | +30 | +15 | +6% | +6% | +1.5% |
| 4 | 300 | +100 | +40 | +20 | +8% | +8% | +2% |
| 5 | 500 | +200 | +50 | +25 | +10% | +10% | +2.5% |

- 1회는 30분이다. 여러 능력치를 고르면 코인을 더해 한 번에 낸다. 추가 경험치는 같은 단계에서 3배라 뺐다. 코인은 매월 1일 0시에 초기화된다.

```
주 수          = 오늘이 든 주부터 이번 달 마지막 주까지 (목요일 0시 주간 초기화, 달 밖은 잘라 냄)
사용 횟수      = 주간 사용 횟수 × 주 수
고정 코인      = Σ 캐릭터 (고정한 단계의 1회 코인 합) × 사용 횟수
자동 배분 코인 = 이번 달 코인 − 고정 코인          (음수면 고정 단계를 낮춰야 한다)
남는 코인      = 이번 달 코인 − 고정 코인 − 자동 배분에 쓴 코인
```

- **자동 칸** = 캐릭터 × 자동 능력치. 칸을 한 번 쓰는 것을 한 단계씩 올리는 일을, 올리는 코인이 싼 것부터(1단계 50 → 2·3단계 75 → 4단계 100 → 5단계 200) 남은 코인으로 채운다. 그래서 다섯 능력치가 같은 단계로 고르게 오른다. 같은 단계 안에서는 보뎀 → 방무 → 공/마 → 크뎀 → 올스탯, 목록 위쪽 캐릭터부터다.
- 사용 1회 단위로 채우므로 칸 하나가 "4단계, 이번 달 5회는 5단계"처럼 나뉠 수 있다. 남는 코인은 다음 칸 하나를 올리는 코인(최대 200)보다 적다. 한 단계 위로 쓰는 회차는 달의 마지막 사용들(후반 주)에 둔다.
- 주 예시: 2026-10-21(수)이면 10/15~10/21(이번 주), 10/22~10/28, 10/29~10/31의 3주. 2026-11-02(월)이면 이번 주는 10/29에 시작했지만 11월 코인으로는 11/1~11/4만 세어 5주.
