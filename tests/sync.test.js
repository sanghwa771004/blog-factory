// 자동 작가 프롬프트(docs/auto-writer-prompt.md)·Claude 안 글공장·앱 검사·서버가 같은 규칙과 버전을 쓰는지 (1.3.1)
// 실제 예약 작업의 프롬프트는 claude.ai 에 따로 저장돼 있어서 여기서는 저장소 사본만 확인할 수 있어 (문서에 그렇게 적혀 있는지도 확인)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEO_RULES, countMe } from '../checks.js';
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
  assert.match(PROMPT, /쓰기는 아래에 적힌 함수 호출만 써: writer_context, job_start, fill_post, job_fail, add_topics, set_variants, set_refresh, add_post, log_run\./);
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
