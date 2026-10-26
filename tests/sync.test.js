// 자동 작가 프롬프트(docs/auto-writer-prompt.md)·Claude 안 글공장·앱 검사·서버가 같은 규칙과 버전을 쓰는지 (1.3.1)
// 실제 예약 작업의 프롬프트는 claude.ai 에 따로 저장돼 있어서 여기서는 저장소 사본만 확인할 수 있어 (문서에 그렇게 적혀 있는지도 확인)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEO_RULES, countMe } from '../checks.js';
import { AUTO_RULES } from '../lib.js';
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
  assert.match(DOC, new RegExp(`${VERSION.replace(/\./g, '\\.')}은 아직 예약 작업에 넣지 않았어`));
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
  assert.match(PROMPT, /키워드나 제목에 주력 주제 낱말/);
  assert.match(PROMPT, /settings\.focus_terms/);
  assert.match(ART, /블로그 주력 주제 이름을 그대로 쓰지 마/);
  assert.match(ART, /키워드나 제목에 주력 주제 낱말이 자연스럽게 드러나게/);
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
