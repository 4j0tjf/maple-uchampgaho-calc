# 유챔 가호 계산기

이번 달 획득 챔피언 코인으로 캐릭터별 **챔피언의 가호** 단계를 정하고, 오늘부터 다음 달 7일(남은 코인 이월 기한)까지 주차별로 몇 단계씩 쓸지 보여 준다. 추가 경험치를 뺀 다섯 능력치(올스탯, 공격력/마력, 보스 몬스터 데미지, 방어율 무시, 크리티컬 데미지)만 계산한다.

시세 사이트(maple-market)·사냥 기록(maple-hunt)·maple-Scheduler와 **따로 도는 별도 앱**이다. 포트, Windows 서비스, `.env`가 따로이고 DB와 상단 메뉴를 같이 쓰지 않는다. 주소만 시세 사이트와 같은 도메인의 **/gaho** 아래를 쓴다(`https://19991115.xyz/gaho/`).

| | |
|---|---|
| 주소 | 외부 `https://19991115.xyz/gaho/` · 서버 PC 안 `http://127.0.0.1:3400/gaho/` (`/gaho`와 `/`는 `/gaho/`로 보낸다) |
| 서버 | `node server.mjs` → `127.0.0.1:3400` (Node 18 이상, 설치할 패키지 없음) |
| 서비스 | `MapleGahoWeb` (NSSM) |
| 설정 | `.env` (`.env.example` 복사): `HOST`, `PORT`, `BASE_PATH`(기본 `/gaho`), `NEXON_API_KEY`, `NEXON_DAILY_LIMIT`, `SCHEDULER_PATH`(기본 `/scheduler`) |
| 외부 연결 | 기존 Cloudflare 터널(`MapleTunnel`)에 `/gaho` 경로 규칙 하나를 더한다(사냥 기록의 `/hunting`과 같은 방식) |
| 저장 | **스케줄러에 로그인하면** 그 계정(스케줄러 DB의 `gaho_states`)에 저장해 어느 기기에서나 이어 쓴다. **로그인 전**에는 브라우저의 `localStorage`(`uchamp-gaho:v1`)에만 남는다. 주소(출처)마다 따로라 `127.0.0.1:3400`과 `19991115.xyz`의 입력값은 서로 다르다. `19991115.xyz`에서는 시세 사이트와 같은 저장소를 쓰지만 키 이름이 겹치지 않는다. |
| 스케줄러 연동 | 같은 도메인의 스케줄러(maple-Scheduler, `/scheduler`) 계정으로 로그인한다. 스케줄러에 등록한 캐릭터를 불러오고, 캐릭터 정보는 그 계정에 등록한 넥슨 API 키로 받는다. 스케줄러에 `/api/gaho`·`/api/gaho/character`가 있어야 한다(아래 '스케줄러 연동'). |
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

4. 밖에서 열기 — 기존 터널(`MapleTunnel`, NSSM 서비스)에 `/gaho` 경로 규칙을 더한다. 설정 파일은 `C:\ProgramData\MapleTunnel\config.yml`이다(`nssm get MapleTunnel AppParameters`의 `--config`). DNS는 이미 있는 `19991115.xyz`를 그대로 쓴다.

   터널은 규칙을 위에서부터 맞춰 보므로, `19991115.xyz` → 3000(시세 사이트) 규칙 **위에** 넣는다. 사냥 기록은 시세 사이트의 rewrite를 거치므로 이 파일에 `/hunting` 규칙이 없다.

   ```yaml
   ingress:
     - hostname: 19991115.xyz
       path: ^/gaho(/.*)?$
       service: http://127.0.0.1:3400
     - hostname: 19991115.xyz
       service: http://127.0.0.1:3000
     - service: http_status:404
   ```

   관리자 PowerShell에서 검사한 뒤 다시 시작한다. `/gaho/`는 3400, `/`는 3000으로 나와야 한다.

   ```powershell
   $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
   $cfg = "C:\ProgramData\MapleTunnel\config.yml"
   & $cf tunnel --config $cfg ingress validate
   & $cf tunnel --config $cfg ingress rule https://19991115.xyz/gaho/
   & $cf tunnel --config $cfg ingress rule https://19991115.xyz/
   Restart-Service MapleTunnel
   ```

   주소를 아는 사람은 누구나 열 수 있다. 넥슨 키는 서버에만 있고 화면에는 나가지 않는다. 남이 캐릭터 조회를 많이 눌러도 하루 `NEXON_DAILY_LIMIT`(기본 300건)에서 멈춰 maple-hunt가 쓸 몫이 남는다.

   터널 없이 같은 공유기의 다른 기기에서만 열려면 `.env`를 `HOST=0.0.0.0`으로 바꾸고 방화벽을 연다: `New-NetFirewallRule -DisplayName "MapleGaho 3400" -Direction Inbound -Protocol TCP -LocalPort 3400 -Action Allow -Profile Private`, 그다음 `Restart-Service MapleGahoWeb`. 주소는 `http://<서버 PC IP>:3400/gaho/`.

## 코드를 고친 뒤 적용

빌드가 없다. 받고 서비스만 다시 시작한다. `.env`를 고쳤을 때도 다시 시작한다. 스케줄러 연동을 처음 켤 때는 **스케줄러를 먼저** 업데이트한다(아래 '스케줄러 연동').

```powershell
cd C:\Development\maple-uchampgaho-calc
git pull
Restart-Service MapleGahoWeb
```

점검: `Invoke-RestMethod http://127.0.0.1:3400/gaho/api/status`가 `nexon : True`면 이미지 조회가 켜져 있다. 오류는 `logs\web.log`에 남는다.

`index.html`은 `styles.css`·`plan.js`·`app.js`를 내용 해시가 붙은 이름(`app.1a2b3c4d5e.js`)으로 부른다. 그래서 코드를 받은 뒤에도 브라우저나 Cloudflare가 지난 파일을 들고 있어서 새 `index.html`과 짝이 어긋나는 일이 없다(어긋나면 스크립트가 중간에 멈춰 캐릭터 목록이 비고 캐릭터 추가가 안 된다). 해시가 붙은 파일은 1년, `index.html`과 해시 없는 이름은 매번 확인(`no-cache`)으로 내준다.

## 화면

0. **스케줄러 계정 · 넥슨 계정 탭** (맨 위)
   - **스케줄러 계정**: 스케줄러 아이디·비밀번호로 로그인한다(스케줄러와 같은 계정, 같은 세션이라 한쪽에서 로그인하면 다른 쪽도 로그인돼 있다). 가입·넥슨 API 키 등록·비밀번호 변경은 스케줄러에서 한다(**스케줄러 열기**). 로그아웃하면 스케줄러에서도 로그아웃된다.
   - 로그인하면 값을 그 계정에 저장한다(입력을 멈추고 0.8초 뒤, 상태에 "저장하는 중… / 스케줄러에 저장됨 / 저장 실패"). 다른 기기·창에서 먼저 저장했으면 덮어쓰지 않고 그 값으로 바꾼 뒤 알린다. 저장에 실패하면 **다시 저장**.
   - **처음 로그인**하면 이 브라우저에 넣어 둔 값(예시가 아니면)을 첫 탭으로 옮기고, 스케줄러에 등록한 캐릭터를 모두 넣는다. 이름이 같은 캐릭터는 하나로 잇는다. 로그아웃하면 이 브라우저에 넣어 둔 값으로 돌아간다.
   - **넥슨 계정 탭**: 챔피언 코인은 넥슨 계정(유니온)마다 따로라서 탭마다 코인·이월 코인·이번 주 포함 여부·캐릭터를 따로 계산한다. **+ 넥슨 계정 추가**(20개까지), **이 탭 이름**, **탭 삭제**(탭이 둘 이상일 때, 확인을 묻는다). 탭에는 캐릭터 수가 붙는다. 로그인하지 않아도 탭을 쓸 수 있다.
   - 로그인은 스케줄러와 같은 주소(`19991115.xyz/gaho/`)로 열었을 때만 된다. 서버 PC의 `127.0.0.1:3400/gaho/`에는 스케줄러가 없어서 "이 주소에서는 쓸 수 없음"으로 나오고 브라우저에만 저장한다.
1. **이번 달 획득 코인**: 이번 달 코인을 넣는다. 주 수는 오늘(한국 시간)부터 다음 달 7일까지로 자동 계산한다(다음 달로 넘어간 주는 **이월**로 표시). 이번 주를 이미 썼으면 "이번 주에도 쓸 수 있음"을 끈다. 그 아래 두 칸:
   - **지난달에서 이월된 코인**(입력): 1~7일에만 넣을 수 있다(8일부터는 그 코인이 사라져서 칸을 닫고 다음에 넣을 날을 알려 준다). 게임에 나오는 지난달 이월 코인을 넣으면 7일까지 쓰는 주에 먼저 배분하고, 다 못 쓰는 코인은 사라진다고 알린다. 다른 달에 넣은 값은 쓰지 않는다.
   - **다음 달로 이월 예정 코인**(출력): 이번 달 마지막 날까지 쓰고 남아 다음 달 1일 0시에 넘어갈 이번 달 코인. 그중 다음 달 7일까지 쓰는 코인과 사라지는 코인을 함께 적는다. 다음 달에 걸친 주(예: 11/26~12/2)는 시작하는 목요일에 쓴다고 보고 이번 달로 세며, 그 주를 다음 달 1일 뒤에 쓰면 그만큼 더 넘어간다고 알린다. 다음 달 1~7일에는 게임의 실제 이월 코인을 위 입력 칸에 넣는다.
2. **캐릭터 / 캐릭터 추가**: 이름을 넣고 추가하면 넥슨 캐릭터 이미지·레벨·직업·월드가 붙는다(로그인하면 그 계정의 넥슨 API 키로, 로그인 전에는 계산기 서버의 키로 찾는다. 스케줄러에 등록한 캐릭터면 넥슨을 부르지 않고 스케줄러 값을 쓴다). 로그인하면 **스케줄러에 등록한 캐릭터** 중 어느 탭에도 없는 캐릭터가 위에 나와서 누르면 지금 탭에 넣는다(**모두 추가**). 탭에서 지운 캐릭터는 다시 이 목록에 나오므로, 넥슨 계정이 여럿이면 첫 탭에서 지우고 다른 탭에서 넣는다. 주간 사용 횟수는 기본 1이고 위 화살표 +1, 아래 화살표 −1(입력 칸에서 키보드 ↑↓도 같다). 능력치 칸에서 단계를 고르면 그 능력치를 매번 그 단계로 쓴다(고정, **한 번에**로 다섯 칸을 함께 바꾼다). **안 씀**은 0단계 고정, **자동**은 계산기가 정한다.
3. **월간 플랜**: 캐릭터별 단계, 1회 코인, 이번 달 코인. 한 단계 위로 쓰는 횟수가 있으면 "4~5단계 · 5단계 5회 · 4단계 1회"처럼 적는다.
4. **주차별 사용**: 주마다 캐릭터별 코인(1회 코인 × 횟수), 기본 단계보다 위로 쓰는 능력치, 주 합계, 누적, 남은 코인(지난달 이월 코인이 남아 있거나 사라지면 함께 적는다).
5. **주차별 캐릭터 상세 사용**: 캐릭터마다 주차 × 능력치 표로 몇 단계(+수치)를 쓰는지. 한 주 안에서 단계가 갈리면 줄을 나눈다.

## 서버와 넥슨 Open API

- 모든 경로는 `BASE_PATH`(기본 `/gaho`) 아래다. 화면은 파일과 API를 상대 경로로 부르므로 주소가 `/gaho/`처럼 `/`로 끝나야 한다. 그래서 `/gaho`와 `/`는 `/gaho/`로 보내고, `/gaho` 밖의 경로는 404다.
- `GET /gaho/` 화면 파일(`index.html`, `styles.css`, `app.js`, `plan.js`, `icon.svg`)만 내준다. `.env`·서버 코드는 경로를 맞춰도 404다. 스크립트·스타일은 `app.<내용 해시>.js`처럼 해시가 붙은 이름으로도 받는다(`index.html`이 이 이름으로 부른다).
- `GET /gaho/api/status` → `{ nexon, scheduler }`: 서버에 키가 있는지, 같은 도메인의 스케줄러 주소(`SCHEDULER_PATH`, 비우면 `""`로 로그인을 끈다). 화면은 이것으로 이미지 조회와 스케줄러 로그인을 켜고 끈다.
- `GET /gaho/api/character?name=` → `{ name, image, level, job, world }`. 서버가 넥슨 `GET /maplestory/v1/id?character_name=`로 ocid를, `GET /maplestory/v1/character/basic?ocid=`로 기본 정보를 받는다(헤더 `x-nxopen-api-key`). 실패하면 `{ error: { code, short, message } }`.
- 호출을 아낀다: ocid 7일, 기본 정보 1시간 캐시. 서버 전체에서 한 줄로 세워 초당 5건을 넘지 않는다. 하루(한국 날짜) `NEXON_DAILY_LIMIT`건을 넘으면 막는다. 캐릭터 1명 조회에 2건 든다.
- 화면은 캐릭터를 추가하거나 이름을 고칠 때, "캐릭터 이미지 새로고침"을 누를 때, 페이지를 열었을 때 하루 넘은 정보만 다시 부른다(코디를 바꾸면 이미지 주소가 바뀐다).
- `index.html`을 서버 없이 파일로 열어도 계산은 된다. 이미지만 나오지 않는다.

## 스케줄러 연동

스케줄러 세션 쿠키는 `Path=/scheduler`라 `/gaho` 요청에는 붙지 않는다. 그래서 이 서버는 로그인·계정 값·넥슨 키를 다루지 않고, **화면이 같은 도메인의 스케줄러 API를 직접** 부른다(같은 출처라 쿠키가 붙고, 스케줄러의 Origin 확인도 통과한다). 넥슨 키 원문은 스케줄러 밖으로 나오지 않는다.

| 스케줄러 API | 쓰는 곳 |
|---|---|
| `GET/POST/DELETE /scheduler/api/session` | 로그인 확인·로그인·로그아웃 |
| `GET /scheduler/api/characters` | 스케줄러에 등록한 캐릭터(이미지·레벨·직업·월드)와 계정에 넥슨 키가 있는지 |
| `GET/PUT /scheduler/api/gaho` | 이 계산기 값(넥슨 계정 탭 전체)을 계정마다 저장 `{ state, base }`. 다른 곳에서 먼저 저장했으면 409와 저장본 |
| `GET /scheduler/api/gaho/character?name=` | 그 계정의 넥슨 키로 캐릭터 조회(스케줄러에 등록하지 않는다, 같은 이름은 1시간 저장본) |

`/api/gaho`와 `/api/gaho/character`는 maple-Scheduler에 이 기능과 함께 더했다(DB 테이블 `gaho_states`). 적용 순서:

1. 스케줄러(`C:\Development\maple-Scheduler`)에서 이 기능이 든 코드를 받고 배포 스크립트를 실행한다. DB 변경(`prisma migrate deploy`)도 함께 적용된다.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy.ps1
   ```

2. 이 계산기를 받고 `Restart-Service MapleGahoWeb`.

스케줄러를 업데이트하기 전에 계산기만 바꾸면 로그인은 되지만 "스케줄러에 이 기능이 없습니다"라고 알리고 브라우저에 저장한다.

## 파일

- `server.mjs`: 화면 파일과 `/api/*`. `nexon.mjs`: 넥슨 조회(캐시, 줄 세우기, 하루 한도).
- `plan.js`: 계산(배분, 이월 코인, 사용 회차별 단계, 주차별 계획, 이월 예정 코인, 남은 주). 화면과 테스트가 함께 쓴다. 모듈이 아닌 일반 스크립트로 `window.GahoPlan`에 붙는다.
- `app.js`: 화면(넥슨 계정 탭, 스케줄러 로그인·저장·캐릭터 불러오기 포함). `styles.css`: maple-market·maple-hunt와 같은 라이트·다크 토큰(시스템 테마를 따른다).
- `tests/plan.test.js`: 계산 테스트. `tests/server.test.mjs`: 서버·넥슨 조회 테스트(넥슨은 흉내 낸 응답).

## 계산

수치 출처: [메이플스토리 공식 가이드 「유니온 챔피언이란?」](https://maplestory.nexon.com/Guide/N23GameInformation/Articles/409), [나무위키 「유니온 챔피언」](https://namu.wiki/w/%EC%9C%A0%EB%8B%88%EC%98%A8%20%EC%B1%94%ED%94%BC%EC%96%B8) (2026-10 확인). 이월 규칙은 공식 가이드 「유니온 챔피언이란?」의 챔피언 코인 항목(2026-11 확인). 패치로 바뀌면 `plan.js`의 `LEVEL_COST`, `STATS`, `CARRY_DAYS`만 고친다.

| 단계 | 1회 코인 | 앞 단계보다 | 올스탯 | 공/마 | 보뎀 | 방무 | 크뎀 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | +50 | +10 | +5 | +2% | +2% | +0.5% |
| 2 | 125 | +75 | +20 | +10 | +4% | +4% | +1% |
| 3 | 200 | +75 | +30 | +15 | +6% | +6% | +1.5% |
| 4 | 300 | +100 | +40 | +20 | +8% | +8% | +2% |
| 5 | 500 | +200 | +50 | +25 | +10% | +10% | +2.5% |

- 1회는 30분이다. 여러 능력치를 고르면 코인을 더해 한 번에 낸다. 추가 경험치는 같은 단계에서 3배라 뺐다.
- 코인은 매월 1일 0시에 초기화되지만, 그때 남은 코인은 **이월되어 초기화 후 7일간(다음 달 7일 23:59:59까지) 남고, 코인을 쓸 때 이월 코인부터 먼저 빠진다**(공식 가이드). 그래서 이번 달 코인은 다음 달 7일까지의 주로 나눈다. 7일은 `plan.js`의 `CARRY_DAYS`.

```
주 수          = 오늘이 든 주부터 다음 달 7일이 든 주까지 (목요일 0시 주간 초기화, 이번 달 1일 앞과 다음 달 7일 뒤는 잘라 냄)
사용 횟수      = 주간 사용 횟수 × 주 수
고정 코인      = Σ 캐릭터 (고정한 단계의 1회 코인 합) × 사용 횟수
자동 배분 코인 = 이번 달 코인 (+ 지난달 이월 코인) − 고정 코인    (모자라면 고정 단계를 낮춰야 한다)
남는 코인      = 이번 달 코인 − 고정 코인 − 자동 배분에 쓴 코인 (이월 코인에서 낸 몫은 빼고)
```

- **자동 칸** = 캐릭터 × 자동 능력치. 칸을 한 번 쓰는 것을 한 단계씩 올리는 일을, 올리는 코인이 싼 것부터(1단계 50 → 2·3단계 75 → 4단계 100 → 5단계 200) 남은 코인으로 채운다. 그래서 다섯 능력치가 같은 단계로 고르게 오른다. 같은 단계 안에서는 보뎀 → 방무 → 공/마 → 크뎀 → 올스탯, 목록 위쪽 캐릭터부터다.
- 사용 1회 단위로 채우므로 칸 하나가 "4단계, 이번 달 5회는 5단계"처럼 나뉠 수 있다. 남는 코인은 다음 칸 하나를 올리는 코인(최대 200)보다 적다. 한 단계 위로 쓰는 회차는 달의 마지막 사용들(후반 주)에 둔다.
- **지난달 이월 코인**(1~7일만): 사용을 7일까지 쓰는 앞쪽 주와 그 뒤로 나눈다. 앞쪽 주는 이월 코인부터, 모자라면 이번 달 코인으로 내고 뒤쪽 주는 이번 달 코인으로만 낸다. 이월 코인이 고르게 나눈 몫보다 많으면 앞쪽 주만 더 높은 단계로 올려 기한 안에 다 쓴다. 앞쪽 주를 모두 5단계로 써도 남거나, 이번 주를 빼서 7일까지 쓸 주가 없으면 남는 이월 코인은 사라진다고 알린다.
- 주 예시: 2026-10-21(수)이면 10/15~10/21(이번 주), 10/22~10/28, 10/29~11/4, 11/5~11/7의 4주. 2026-11-10(화)이면 11/5~11/11부터 11/26~12/2, 12/3~12/7까지 5주. 2026-11-02(월)이면 이번 주는 10/29에 시작했지만 11월 코인으로는 11/1부터 세어 11/1~11/4 … 12/3~12/7의 6주이고, 10월 이월 코인은 11/7까지인 앞 두 주(11/1~11/4, 11/5~11/7)에 쓴다. 12월은 다음 해 1/7까지 센다.
