// 자동 작가 프롬프트(docs/auto-writer-prompt.md)·Claude 안 글공장·앱 검사·서버가 같은 규칙과 버전을 쓰는지 (1.3.1)
// 실제 예약 작업의 프롬프트는 claude.ai 에 따로 저장돼 있어서 여기서는 저장소 사본만 확인할 수 있어 (문서에 그렇게 적혀 있는지도 확인)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEO_RULES, countMe, PLAN_KINDS, PLAN_RUNS, DEFAULT_PLAN, KEEP_DAYS, PLAN_MAX_PER_KIND, promptsOf, parseBody, isAppDrawnSlot, VOICE_PRESETS, figureNumbers, FEED_RULES, CLICKBAIT, thumbText, feedCheck } from '../checks.js';
import { AUTO_RULES, BACKLOG_STAGES, RESCHEDULE_STAGES, backlogInfo, autoPlan } from '../lib.js';
import { isOwnPhotoSlot } from '../images.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const VERSION = JSON.parse(read('version.json')).version;
const DOC = read('docs/auto-writer-prompt.md');
const PROMPT = DOC.split('\n---\n')[1].split('\n---')[0];
const ART = read('claude-artifact/blog-factory.html');

test('버전이 모두 같음: version.json · 앱 · 서버 · 자동 작가 프롬프트 · Claude 안 글공장', () => {
  assert.match(read('app.js'), new RegExp(`const APP_VER = '${VERSION.replace(/\./g, '\\.')}'`));
  assert.match(read('supabase/functions/blog-app/index.ts'), new RegExp(`const VERSION = "${VERSION.replace(/\./g, '\\.')}"`));
  assert.ok(DOC.startsWith(`# 자동 작가 예약 작업 프롬프트 (${VERSION})`), '문서 제목 버전');
  assert.ok(PROMPT.includes(`정기 실행 (${VERSION})]`), '프롬프트 안 버전');
  assert.ok(ART.includes(`홈 화면 앱 ${VERSION} 기준`), 'Claude 안 글공장이 기준으로 삼는 앱 버전');
});

test('문서가 저장소 사본과 실제 예약 작업이 따로라는 것과 반영 상태를 밝힘 (검증 안 한 걸 검증했다고 쓰지 않음)', () => {
  assert.match(DOC, /이 파일을 고쳐도 예약 작업은 저절로 바뀌지 않아/);
  assert.match(DOC, /반영 상태/);
  // 이 버전을 예약 작업에 넣었는지 아닌지 둘 중 하나를 꼭 밝힘 (넣었으면 날짜와 함께)
  const v = VERSION.replace(/\./g, '\\.');
  assert.match(DOC, new RegExp(`(${v}은 아직 예약 작업에 넣지 않았어|실제 예약 작업에 \\*\\*${v}\\*\\* 프롬프트를 넣었어 \\(\\d{4}-\\d{2}-\\d{2})`));
  // 실제 예약 실행 결과를 확인하기 전에는 '검증 안 됨'
  assert.match(DOC, /검증 안 됨/);
  assert.doesNotMatch(DOC, /검증 완료/);
});

test('하루 발행량: 프롬프트의 목표·한 번에 쓰는 수가 앱 계산(AUTO_RULES)과 같고, 고른 값을 그대로 따름', () => {
  assert.ok(PROMPT.includes('목표 = settings.per_day × 7'));
  assert.equal(AUTO_RULES.days, 7);
  assert.ok(PROMPT.includes(`한 번 실행에 최대 ${AUTO_RULES.maxAutoPerRun}편`) && PROMPT.includes(`합쳐 최대 ${AUTO_RULES.maxPerRun}편`));
  assert.ok(PROMPT.includes(`한 번에 최대 ${AUTO_RULES.maxJobsPerRun}개`), '작업 처리 수');
  assert.match(PROMPT, /per_day 는 사용자가 고른 값이야 — 앱 권장\(하루 1편\)과 달라도 바꾸지 말고/);
  assert.equal(SEO_RULES.perDayRecommended, 1);
  assert.ok(PROMPT.includes("항상 '검수 필요'로 저장"), '자동 원고는 사람 검수');
});

test('주제 규칙: 카테고리를 주력 주제로 덮어쓰지 않고, 키워드·제목에 주제 낱말 (앱 판정과 같은 근거)', () => {
  assert.doesNotMatch(PROMPT, /category = focus_topic/);
  assert.match(PROMPT, /주력 주제 이름을 모든 글의 category 에 그대로 넣지 마/);
  assert.match(PROMPT, /settings\.focus_terms\(주력 주제 낱말\)가 있으면 그 낱말 중 하나가 키워드나 제목에 자연스럽게 들어가게/);
  assert.match(PROMPT, /settings\.focus_terms/);
  assert.match(ART, /블로그 주력 주제 이름을 그대로 쓰지 마/);
  assert.match(ART, /키워드나 제목에 주력 주제 낱말이 자연스럽게 드러나게/);
  // 앱 판정 규칙(checks.js focusFit)과 같은 말: 설정 낱말 하나, 없으면 이름 전체나 낱말 두 개 이상, 억지로 넣지 않음
  assert.match(PROMPT, /focus_terms 가 비어 있으면 주력 주제 이름 전체나 그 이름의 낱말 두 개 이상/);
  assert.match(PROMPT, /억지로 넣지 마/);
  assert.match(ART, /주력 주제 이름 전체나 그 낱말 두 개 이상이 있어야 확인돼/);
  // 주제 추천·채택 주제·요청 원고도 카테고리를 주력 주제 이름으로 채우지 않음
  assert.match(PROMPT, /payload\.category 가 주력 주제 이름\(settings\.focus_topic\)과 같으면 그 안의 세부 분류/);
  assert.match(PROMPT, /post\.category 가 비어 있으면 글에 맞는 세부 분류로 정해/);
  assert.match(PROMPT, /주제의 category 가 주력 주제 이름 그대로면 글의 세부 분류로/);
});

test('키워드·링크·경험·사진 규칙이 앱 검사 숫자·표시와 같음', () => {
  assert.equal(SEO_RULES.minKeywordWords, 3);
  assert.ok(PROMPT.includes('3~5어절'));
  assert.equal(SEO_RULES.maxLinks, 2);
  assert.ok(PROMPT.includes('모두 합쳐 2곳까지') && ART.includes('모두 합쳐 2곳까지'));
  assert.ok(PROMPT.includes('첫 소제목 앞에는 넣지 마') && ART.includes('첫 소제목 앞에는 넣지 마'));
  // 프롬프트가 남기라는 자리 표시를 앱이 그대로 알아봄
  const own = PROMPT.match(/"\[이미지: \(직접 찍기\) [^"]*\]"/)[0].slice(1, -1);
  assert.equal(isOwnPhotoSlot(own.replace(/^\[이미지:\s*|\]$/g, '')), true);
  assert.ok(ART.includes('[이미지: (직접 찍기) 무엇을 찍을지]'));
  const me = PROMPT.match(/"\[내 경험: [^"]*\]"/)[0].slice(1, -1);
  assert.equal(countMe(me), 1, '빈 [내 경험] 자리는 앱이 미완성으로 알아봄');
});

test('1.4.0 운영: 쌓인 원고 한도·개선안·유입 검색어 규칙이 프롬프트·앱·DB·서버에서 같음', () => {
  const M016 = read('supabase/migrations/016_operations_1_4_0.sql');
  const APP = read('app.js');
  const SRV = read('supabase/functions/blog-app/index.ts');
  // 쓰기 함수 목록에 개선안 저장(set_refresh)이 있음
  // 1.7.0: 사람 말투로 다듬기(set_polish)가 더해짐
  assert.match(PROMPT, /쓰기는 아래에 적힌 함수 호출만 써: expire_auto_posts, writer_context, job_start, fill_post, job_fail, add_topics, set_variants, set_refresh, set_polish, add_post, log_run\./);
  // 쌓인 원고: 같은 단계(검수 필요·정보 필요·발행 준비·예약)와 같은 기본 한도(하루 발행 수 × 7)
  assert.deepEqual(BACKLOG_STAGES, ['review', 'verify', 'ready', 'scheduled']);
  assert.ok(M016.includes("p.stage in ('review', 'verify', 'ready', 'scheduled')"), 'DB backlog_state 가 같은 단계를 셈');
  assert.ok(M016.includes('greatest(coalesce(s.per_day, 1), 1) * 7'), 'DB 기본 한도 = 하루 발행 수 × 7');
  assert.equal(backlogInfo([], { per_day: 2 }).limit, 2 * AUTO_RULES.days);
  assert.equal(backlogInfo([], { per_day: 2, backlog_limit: 5 }).limit, 5);
  assert.match(PROMPT, /backlog_limit\(쌓아둘 원고 한도, 0이면 per_day × 7\)/);
  assert.match(PROMPT, /backlog\.backlog 가 backlog\.limit 이상이면 3단계를 통째로 건너뛰어/);
  assert.ok(M016.includes("coalesce(nullif(p->>'source', ''), 'auto') = 'auto'") && M016.includes('backlog full'), 'DB 도 자동 글만 막음');
  // 새로 쓸 자동 글 수: 한도 − 쌓인 원고 − 2단계에서 채운 요청 원고 (채우면 '검수 필요'가 돼서 쌓인 원고가 늘어) — 앱 계산도 같게
  assert.match(PROMPT, /새로 쓸 수 있는 자동 글 수는 backlog\.limit − backlog\.backlog 에서 2단계에서 fill_post·add_post 로 저장한 원고 수를 뺀 만큼까지야/);
  const five = Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, stage: 'review' }));
  const st = { per_day: 1, auto_enabled: true, focus_topic: '겨울 가전' };
  assert.equal(autoPlan({ posts: five, settings: st, pendingWrites: 0 }).autoNext, 2);
  assert.equal(autoPlan({ posts: five, settings: st, pendingWrites: 1 }).autoNext, 1);
  assert.equal(autoPlan({ posts: five, settings: st, pendingWrites: 2 }).autoNext, 0, '요청 원고 2편을 채우면 7/7이라 DB add_post 가 자동 글을 거절함');
  // 날짜 다시 잡기·overdue 는 예약 원고를 빼고 같은 단계 (예약한 날이 지난 글은 이미 올라갔을 수 있음)
  assert.deepEqual(RESCHEDULE_STAGES, ['review', 'verify', 'ready']);
  assert.equal((M016.match(/p\.stage in \('review', 'verify', 'ready'\)/g) || []).length, 2, 'DB backlog_state overdue·reschedule_overdue 가 같은 단계');
  assert.ok(!/reschedule_overdue[\s\S]*?stage in \('review', 'verify', 'ready', 'scheduled'\) and p\.publish_date < kst_today/.test(M016), 'reschedule_overdue 는 예약 원고를 안 옮김');
  // 개선안: 프롬프트가 쓰는 칸 = 앱이 보여주는 칸, 고칠 점(focus) 목록이 셋 다 같음
  for (const k of ['titles', 'intro', 'headings', 'add_sections', 'cta', 'link_positions', 'keep', 'based_on', 'notes']) {
    assert.ok(PROMPT.includes(`"${k}"`), `프롬프트 개선안 JSON: ${k}`);
    assert.ok(APP.includes(`rf.${k}`), `앱 개선안 칸: ${k}`);
  }
  const focus = ['all', 'title', 'ctr', 'conversion', 'search'];
  assert.ok(SRV.includes(`const REFRESH_FOCUS = ${JSON.stringify(focus).replace(/,/g, ', ')};`), '서버 focus 목록');
  assert.ok(PROMPT.includes('payload.focus(all / title / ctr / conversion / search)'), '프롬프트 focus 목록');
  for (const f of focus) assert.match(APP, new RegExp(`\\b${f}: '`), `앱 focus: ${f}`);
  // 개선안 JSON 은 중괄호까지 있는 객체 하나라서 템플릿이 중괄호를 또 감싸면 {{…}} 가 돼 jsonb 변환이 실패함 (fill_post 와 같은 모양)
  assert.match(PROMPT, /select public\.set_refresh\('<post_id>', '<작업 id>', \$gf\$<개선안 JSON>\$gf\$::jsonb\);/);
  assert.doesNotMatch(PROMPT, /\$gf\$\{<개선안 JSON>\}\$gf\$/);
  assert.match(PROMPT, /## 개선안 규칙 \(refresh\)\n- 개선안 JSON \(유효한 JSON 객체 하나[^\n]*\n\{\n/, '개선안 JSON 정의는 { 로 시작하는 객체');
  assert.match(PROMPT, /select public\.fill_post\('<post_id>', \$gf\$<원고 JSON>\$gf\$::jsonb\);/);
  assert.match(PROMPT, /set_refresh 는 그 글의 기다리는 개선안 작업 번호일 때만 저장돼/);
  assert.ok(M016.includes("raise exception 'refresh job is not pending for this post'"), 'DB 도 작업 번호가 안 맞으면 저장 없이 오류');
  // 실적이 없을 때 writer_context 는 null 이 아니라 rows 0 (숫자 칸은 null) — 프롬프트도 그렇게 설명
  assert.match(PROMPT, /rows 가 0이면 실적이 없는 거고 숫자 칸은 null — 0으로 쓰지 마/);
  assert.doesNotMatch(PROMPT, /last_date, 없으면 null\)/);
  assert.match(PROMPT, /글 본문은 바꾸지 말고 개선안만 만들어/);
  // 유입 검색어: 사용자가 옮겨 적은 숫자만 근거로, 부풀리지 않음
  assert.match(PROMPT, /search_terms_top: 최근 90일 실제 유입 검색어/);
  assert.match(PROMPT, /숫자는 그대로, 부풀리지 마/);
  assert.ok(M016.includes("'search_terms_top'"), 'DB writer_context 에 유입 검색어');
});

test('1.6.0 하루 계획: 종류·편수·시각·보관일·사진 프롬프트 규칙이 프롬프트·앱·DB(020)에서 같음', () => {
  const M020 = read('supabase/migrations/020_daily_plan_1_6_0.sql');
  const APP = read('app.js');
  const kinds = Object.keys(PLAN_KINDS);
  assert.deepEqual(kinds, ['affiliate', 'adpost', 'trending', 'market', 'stock']);
  // DB 검사·계획 합계·add_post 가 같은 종류만 받음
  const list = kinds.map((k) => `'${k}'`).join(', ');
  assert.ok(M020.includes(`check (plan_kind in ('', ${list}))`), 'posts_plan_kind_check');
  assert.ok(M020.includes(`e.key in (${list})`), 'plan_total 종류');
  assert.ok(M020.includes(`if pk not in ('', ${list}) then`), 'add_post 종류');
  // 기본 계획·종류별 최대·보관일
  assert.ok(M020.includes(`default '${JSON.stringify(DEFAULT_PLAN).replace(/:/g, ': ').replace(/,/g, ', ')}'::jsonb`), 'DB 기본 계획 = 앱 DEFAULT_PLAN');
  assert.ok(M020.includes(`least(greatest(e.value::int, 0), ${PLAN_MAX_PER_KIND})`) && M020.includes(`least((s.daily_plan->>pk)::int, ${PLAN_MAX_PER_KIND})`), '종류마다 최대 4편');
  assert.ok(M020.includes(`keep_days int not null default ${KEEP_DAYS.def}`) && M020.includes(`check (keep_days between ${KEEP_DAYS.min} and ${KEEP_DAYS.max})`));
  // 프롬프트: 종류 id 와 실행 시각, 저장 방법, 한 번 실행 최대 편수
  for (const k of kinds) assert.ok(PROMPT.includes(`${k}(`) || PROMPT.includes(`- ${k} —`), `프롬프트 종류 ${k}`);
  assert.match(PROMPT, /"plan_kind":"<종류>"/);
  assert.ok(PROMPT.includes(`계획 글은 한 번 실행에 최대 ${AUTO_RULES.maxPlanPerRun}편, 2단계에서 쓴 원고까지 합쳐 최대 ${AUTO_RULES.maxPlanTotalPerRun}편`));
  assert.ok(PROMPT.includes('select public.expire_auto_posts();'), '실행마다 먼저 정리');
  assert.ok(PROMPT.includes(`affiliate 는 ${JSON.stringify(PLAN_KINDS.affiliate.programs)}`) && PROMPT.includes(`나머지는 ${JSON.stringify(PLAN_KINDS.adpost.programs)}`), '종류별 수익 모델');
  // 실행 시각: 앱(RUN_TIMES)·PLAN_RUNS·문서의 예약 작업 cron 이 같음
  const rt = APP.match(/const RUN_TIMES = (\[\[[^;]+\]\]);/)[1];
  assert.equal(rt, '[[8, 51], [13, 21], [18, 51]]');
  assert.deepEqual(Object.values(PLAN_RUNS).map((r) => r.time), ['오전 8:51', '오후 1:21', '저녁 6:51']);
  assert.ok(DOC.includes('`CRON_TZ=Asia/Seoul 51 8,18 * * *`') && DOC.includes('`CRON_TZ=Asia/Seoul 21 13 * * *`'));
  assert.match(PROMPT, /아침 실행 \(11시 전\)[\s\S]*점심 실행 \(11시~16시 전\)[\s\S]*저녁 실행 \(16시부터\)/);
  // 사진: 3~6곳, 자리마다 [프롬프트: …] — 앱이 그 줄을 사진의 프롬프트로 읽음
  assert.ok(PROMPT.includes(`한 줄로 ${SEO_RULES.imagesMin}~${SEO_RULES.imagesMax}곳`));
  assert.ok(PROMPT.includes('"[프롬프트: …]"'));
  const sample = '[이미지: 창가 제습기]\n[프롬프트: 창가 책상 위 흰색 제습기, 오전 자연광, 4:3, 글자 없이]';
  assert.deepEqual(promptsOf(sample), [{ n: 1, text: '창가 제습기', prompt: '창가 책상 위 흰색 제습기, 오전 자연광, 4:3, 글자 없이', app: false }]);
  // 강조: ==문장== 과 "> " 핵심 상자를 앱이 알아봄
  assert.ok(PROMPT.includes('"==문장=="') && PROMPT.includes('"> " 로 시작하는 한 줄 상자'));
  assert.deepEqual(parseBody('> 핵심: 소음부터 봐').map((b) => b.t), ['note']);
  // 투자 글 안내 문구는 앱 검사가 알아봄
  const disc = PROMPT.match(/글 끝에 꼭: "([^"]+)"/)[1];
  assert.match(disc, /투자 권유가 아니에요/);
});

test('1.7.0 전문성·사람 말투: 사진 자리·상자·말투·다듬기·숫자 확인표 규칙이 프롬프트·앱·DB(021)·Claude 안 글공장에서 같음', () => {
  const M021 = read('supabase/migrations/021_pro_voice_1_7_0.sql');
  const APP = read('app.js');
  const SRV = read('supabase/functions/blog-app/index.ts');
  // 앱이 그리는 사진 자리: 프롬프트가 남기라는 표시를 앱이 그대로 알아봄 (Claude 안 글공장도 같은 표시)
  for (const re of [/"\[이미지: \(썸네일\) [^"\]]*\]"/, /"\[이미지: \(정보 카드\) [^"\]]*\]"/]) {
    const slot = PROMPT.match(re)[0].slice(1, -1);
    assert.equal(isAppDrawnSlot(slot.replace(/^\[이미지:\s*|\]$/g, '')), true, slot);
    assert.equal(promptsOf(slot + '\n[프롬프트: 앱이 그리는 정보 카드 — 제미나이 필요 없음]')[0].app, true);
  }
  assert.ok(ART.includes('[이미지: (썸네일) 썸네일 문구]') && ART.includes('[이미지: (정보 카드) 무엇을 보여줄지]'));
  // [기준: …]·[용어: …] 예시를 앱이 상자로 읽음
  const basis = PROMPT.match(/"(\[기준: [^"]+\])"/)[1];
  assert.equal(parseBody(basis)[0].t, 'basis');
  const term = PROMPT.match(/다음 줄에 "(\[용어: [^"]+\])"/)[1];
  const tb = parseBody(term)[0];
  assert.deepEqual([tb.t, !!tb.term, !!tb.text], ['term', true, true]);
  assert.match(PROMPT, /"\[\^번호\]"\(sources 순서, 1부터\)/);
  // 말투 카드: 프롬프트(규칙 16)·Claude 안 글공장 모두 앱 기본 말투와 같은 글자
  for (const [k, v] of Object.entries(VOICE_PRESETS)) {
    assert.ok(PROMPT.includes(`${k} = "${v.card}"`), '프롬프트 말투 ' + k);
    assert.ok(ART.includes(v.card.replace(/"/g, '"')) || ART.includes(JSON.stringify(v.card).slice(1, -1)), 'Claude 안 글공장 말투 ' + k);
  }
  // 다듬기(polish): 작업 종류가 DB·서버·앱·프롬프트에서 같고, 사진·링크 줄이 바뀌면 DB가 거절
  assert.ok(M021.includes("check (kind in ('write', 'topics', 'reformat', 'refresh', 'polish'))"));
  assert.match(SRV, /kind === "polish"/);
  assert.match(APP, /polish: '/);
  assert.match(PROMPT, /select public\.set_polish\('<post_id>', '<작업 id>', \$gf\$\{"body": "<다듬은 본문>"\}\$gf\$::jsonb\);/);
  assert.ok(M021.includes("raise exception 'polish changed image or link lines'") && PROMPT.includes('DB가 다르면 저장을 거절해'));
  assert.ok(M021.includes("'body', case when r.kind in ('reformat', 'refresh', 'polish') then p.body end"), 'writer_context 가 다듬을 본문을 줌');
  // 숫자 확인표: 프롬프트 JSON 예시의 값을 앱이 숫자로 읽고, 앱 검사가 보는 칸(as_of·source_url)이 예시에 있음
  const figLine = PROMPT.match(/"figures": (\[\{[^\n]+\}\]),?\n/)[1];
  const figs = JSON.parse(figLine);
  assert.deepEqual(Object.keys(figs[0]), ['label', 'value', 'unit', 'as_of', 'source_url', 'source_title']);
  assert.deepEqual([...figureNumbers(figs)], [2601.23]);
  assert.ok(M021.includes("if jsonb_typeof(p->'figures') = 'array' then"), 'DB add_post 가 숫자 확인표를 저장');
  assert.match(APP, /f\.source_title/);
  // 투자 글 채널·시리즈 기본값: DB 기본값 = 프롬프트 설명
  assert.ok(M021.includes(`'{"market": "오늘의 증시", "stock": "종목 한 장 정리"}'::jsonb`) || M021.includes('{"market":"오늘의 증시","stock":"종목 한 장 정리"}'), 'DB 시리즈 기본 이름');
  assert.match(PROMPT, /\[오늘의 증시 11\/3\]/);
  assert.ok(M021.includes("'naver_blog_invest'") && PROMPT.includes('settings.invest_channel'));
  // 틀: writer_context 에 원문·지문(fp) 없이 구성만
  assert.ok(M021.includes("'templates'") && !/'templates'[\s\S]{0,400}'fp'/.test(M021), 'writer_context 틀에 지문을 안 넘김');
});

test('1.8.0 홈판 공략: 결론 맨 위·썸네일 문구·제목 규칙·사진 수·주제 이슈가 프롬프트·Claude 안 글공장·앱 홈판 점검에서 같음', () => {
  // 썸네일 자리 예시를 앱이 썸네일로 알아보고, 문구를 뽑음
  const ex = PROMPT.match(/"\[이미지: \(썸네일\) ([^"\]]+)\]" — 앱이 크게/)[1];
  assert.equal(thumbText('(썸네일) ' + ex), ex);
  assert.ok(isAppDrawnSlot('(썸네일) ' + ex));
  // 결론 맨 위: 프롬프트·Claude 안 글공장 모두 "> 핵심:" 상자, 앱 홈판 점검이 그 상자를 '첫 3줄에 결론'으로 셈
  assert.match(PROMPT, /첫 소제목 앞에 "> 핵심: 이 글의 답 한두 문장" 상자를 꼭/);
  assert.ok(ART.includes('첫 소제목 앞에 \\"> 핵심: 이 글의 답 한두 문장\\" 상자를 꼭'));
  assert.doesNotMatch(PROMPT, /마지막은 3줄 요약/);
  const top = feedCheck({ titles: ['t'], body: `[이미지: (썸네일) ${ex}]\n> 핵심: 답부터\n## 소제목\n본문` }, {});
  assert.equal(top.items.find((x) => x.key === 'top_summary').ok, true);
  // 제목: 25~40자 = 앱 기준, 낚시 말 목록이 앱 검사에 다 걸림
  assert.ok(PROMPT.includes(`제목 3개 모두 ${FEED_RULES.titleGoodMin}~${FEED_RULES.titleGoodMax}자`) && ART.includes(`3개 모두 ${FEED_RULES.titleGoodMin}~${FEED_RULES.titleGoodMax}자`));
  const bait = PROMPT.match(/낚시·과장 말\(([^)]+)\)과 본문에 없는/)[1].split(', ').map((w) => w.replace(/"/g, ''));
  assert.ok(bait.length >= 8);
  for (const w of bait) assert.ok(CLICKBAIT.test(w), '앱 낚시 말 검사: ' + w);
  // 사진 4~8곳 = 앱 기준
  assert.ok(PROMPT.includes(`한 줄로 ${SEO_RULES.imagesMin}~${SEO_RULES.imagesMax}곳`) && ART.includes(`한 줄로 ${SEO_RULES.imagesMin}~${SEO_RULES.imagesMax}곳`));
  assert.equal(FEED_RULES.minImages, SEO_RULES.imagesMin);
  // 오늘 이슈: 블로그 주제와 이어지는 것만, 없으면 주제 안 계절 정보 글
  assert.match(PROMPT, /블로그 주제와 이어지는 이슈가 오늘 없으면 억지로 엮지 말고, 주제 안의 계절 정보 글/);
  assert.match(PROMPT, /trending 은 주제 안 세부 분류/);
});
