// Claude 안 글공장(claude-artifact/blog-factory.html)의 계산 부분 테스트
// 페이지 안 /*PURE-START*/ ~ /*PURE-END*/ 사이 코드만 꺼내서 돌려 (화면·Claude 연결 없이)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../claude-artifact/blog-factory.html', import.meta.url), 'utf8');
const pure = html.match(/\/\*PURE-START\*\/([\s\S]*?)\/\*PURE-END\*\//)[1];
const NAMES = ['parseBody', 'quickCheck', 'normalizePost', 'normalizeTopics', 'normalizeVariants', 'sqlRows', 'dq', 'topicScore',
  'buildWritePrompt', 'buildTopicPrompt', 'buildReformatPrompt', 'exportHtml', 'exportPlain', 'threadsShare', 'instagramText',
  'disclosureFor', 'typeOkHere', 'dbMsg', 'nextRunText', 'EXAMPLE', 'firstChars', 'VAGUE_DISCLOSURE'];
const P = new Function(pure + `\nreturn { ${NAMES.join(', ')} };`)();
const cat = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'));
const prog = Object.fromEntries(cat.programs.map((p) => [p.id, p]));
const ch = Object.fromEntries(cat.channels.map((c) => [c.id, c]));
const C = { prog, ch, compat: cat.compat, fromApp: true };
const inner = (q) => q.match(/(\$gf[a-z0-9]+\$)([\s\S]*?)\1/)[2];

test('Supabase 답 읽기: 감싼 모양이 달라도 행을 꺼냄', () => {
  const text = 'Below is the result...\n\n<untrusted-data-abc>\n[{"post_id":"11111111-2222-3333-4444-555555555555","publish_date":"2026-10-28"}]\n</untrusted-data-abc>\n\nUse this data...';
  assert.equal(P.sqlRows({ payload: { result: text } })[0].publish_date, '2026-10-28');
  assert.equal(P.sqlRows({ payload: text })[0].post_id.length, 36);
  assert.equal(P.sqlRows({ payload: JSON.stringify({ result: text }) })[0].publish_date, '2026-10-28');
  assert.equal(P.sqlRows({ content: [{ type: 'text', text: JSON.stringify({ result: text }) }] })[0].publish_date, '2026-10-28');
  assert.throws(() => P.sqlRows({ payload: '결과 없음' }));
});

test('SQL 문자열 감싸기: 내용 안의 $ 표시와 겹치지 않음', () => {
  const tricky = "a $gfabc$ b $$ c'; drop table x; --";
  const q = P.dq(tricky);
  const tag = q.match(/^\$gf[a-z0-9]*\$/)[0];
  assert.ok(!tricky.includes(tag));
  assert.equal(q, tag + tricky + tag);
});

test('AI 원고 정리: 본문·SNS의 고지문 줄을 빼고, 여기서 못 쓰는 유형은 비움', () => {
  const r = P.normalizePost({
    keyword: '전기요', titles: ['전기요 고르는 법', ''],
    body: '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.\n## 전기요 고를 때\n전기요는 소재와 온도 조절 방식이 중요해요. 매일 쓰는 물건이라 세탁 방법도 같이 봐야 해요.\n[링크: 가격 보기]',
    hashtags: ['#전기요', '전기 요'], threads: '#광고\n전기요 고를 때 이거 봐', content_type: 'comparison', needs_fact_check: ['확인할 문장', 3],
  }, { keyword: '전기요', channel: ch.naver_blog, programs: cat.programs, allowed: ['buying_guide', 'checklist'] });
  assert.ok(!r.body.includes('수수료'));
  assert.ok(r.body.startsWith('## 전기요'));
  assert.equal(r.content_type, '');
  assert.deepEqual(r.hashtags, ['전기요', '전기요']);
  assert.equal(r.threads, '전기요 고를 때 이거 봐');
  assert.deepEqual(r.needs_fact_check, ['확인할 문장']);
  assert.deepEqual(r.titles, ['전기요 고르는 법']);
  assert.throws(() => P.normalizePost({ body: '짧아' }, { keyword: 'k', channel: ch.naver_blog, programs: [], allowed: [] }));
});

test('SNS 채널 원고는 본문이 곧 쓰레드 글', () => {
  const r = P.normalizePost({ body: '전기요 살 때 소재부터 봐야 해\n온도 조절이 세밀한지도 중요해\n세탁 가능한지 꼭 확인해\n자세한 기준은 블로그에 정리해둠' },
    { keyword: 'k', channel: ch.threads, programs: cat.programs, allowed: ['sns_short'], fixedType: 'sns_short' });
  assert.equal(r.threads, r.body);
  assert.equal(r.content_type, 'sns_short');
});

test('미리 검사: 예시 원고는 오류 없이 링크·사진 할 일만', () => {
  const r = P.quickCheck(P.EXAMPLE, C);
  assert.deepEqual(r.errors, []);
  assert.ok(r.todos.some((t) => t.includes('링크 자리 2곳')));
  assert.ok(r.todos.some((t) => t.includes('사진 자리 2곳')));
});

test('미리 검사: 써본 척·가격·빈 경험 칸·안 되는 조합·과장을 잡음', () => {
  const bad = { v: 5, keyword: '가습기', channel_id: 'threads', program_ids: ['google_adsense'], content_type: 'experience_review', experience: '', body: '제가 한 달 동안 써보니 정말 좋았어요. 가격은 39,900원이에요. 무조건 사세요. [내 경험: 소음]', link: '' };
  const r = P.quickCheck(bad, C);
  const all = r.errors.join(' | ');
  for (const k of ['빈 [내 경험]', '실제 경험 후기', '써본 것처럼', '정확한 가격', '쓸 수 없는 조합']) assert.ok(all.includes(k), k);
  assert.ok(r.warns.some((w) => w.includes('무조건')));
});

test('주제 정리: 안 되는 조합 빼고, 점수·출처·신뢰도를 정직하게', () => {
  const nt = P.normalizeTopics([
    { title: '가습기 팁', keyword: '가습기 세척 방법', rec_channels: ['threads', 'nope'], rec_programs: ['google_adsense', 'coupang_partners'], rec_content_type: 'how_to', scores: { demand: { score: 4.4, basis: '겨울', source: '웹 검색', confidence: '높음' }, intent: { score: 9 } } },
    { title: '' }, 'x',
  ], { channels: cat.channels, programs: cat.programs, compat: cat.compat, channelId: 'naver_blog', category: '겨울 가전', hasPerf: false });
  assert.equal(nt.length, 1);
  assert.deepEqual(nt[0].rec_channels, ['threads']);
  assert.deepEqual(nt[0].rec_programs, ['coupang_partners']);
  assert.deepEqual(nt[0].scores.demand, { score: 4, basis: '겨울', source: 'AI 추정', confidence: '보통' });
  assert.equal(nt[0].scores.intent.score, null);
  assert.equal(nt[0].scores.effort.basis, '확인 불가');
  assert.equal(P.topicScore(nt[0], cat.settings.score_weights).total, 80);
});

test('채널별 버전 정리: 고지 줄을 빼고 요청한 것만', () => {
  const v = P.normalizeVariants({ threads: '#광고\n전기요는 소재부터', cards: [{ title: '1', text: 'a' }], extra: 'x' }, ['threads', 'cards'], cat.programs);
  assert.deepEqual(v, { threads: '전기요는 소재부터', cards: [{ title: '1', text: 'a' }] });
  assert.throws(() => P.normalizeVariants({}, ['threads'], cat.programs));
});

test('프롬프트: 웹 없음·가격 금지·링크 자리 규칙이 들어가고 빈 값이 안 섞임', () => {
  const wp = P.buildWritePrompt({ keyword: '원룸 가습기 세척', channel: ch.naver_blog, programs: [prog.coupang_partners], contentType: '', len: '2500', products: [], recent: ['전기요'], today: '2026-10-21', allowed: ['buying_guide', 'how_to'] });
  assert.ok(!/undefined|null/.test(wp));
  assert.ok(wp.includes('[링크: 버튼 문구]') && wp.includes('웹 검색도') && wp.includes('금액'));
  const sp = P.buildWritePrompt({ keyword: 'x', channel: ch.threads, programs: [prog.coupang_partners], contentType: 'sns_short', experience: '6평 원룸에서 두 달 씀', products: [], recent: [], today: '2026-10-21', allowed: ['sns_short'] });
  assert.ok(sp.includes('420자 이내') && !sp.includes('[링크: 버튼 문구]') && sp.includes('6평 원룸에서 두 달 씀'));
  const tp = P.buildTopicPrompt({ category: '겨울 가전', count: 6, mode: 'performance', channel: ch.naver_blog, programs: [prog.coupang_partners], channels: cat.channels, allPrograms: cat.programs, compat: cat.compat, recent: [], perf: [{ keyword: '전기요', views: 120, clicks: 3, orders: null, revenue_est: 0 }], today: '2026-10-21' });
  assert.ok(tp.includes('google_adsense × threads') && tp.includes('조회 120') && tp.includes('주문 없음') && !/undefined/.test(tp));
});

test('복사: 고지문은 맨 위, 제휴 링크는 그대로 링크 자리에', () => {
  const d = { ...P.EXAMPLE, link: 'https://link.coupang.com/a/abc' };
  const html = P.exportHtml(d, prog);
  assert.ok(html.indexOf('쿠팡 파트너스 활동의 일환') < html.indexOf('<h2'));
  assert.equal((html.match(/link\.coupang\.com\/a\/abc/g) || []).length, 2);
  assert.ok(html.includes('rel="noopener nofollow sponsored"'));
  assert.ok(P.exportPlain(d, prog).startsWith('이 게시물은 쿠팡 파트너스'));
  const th = P.threadsShare(d, prog);
  assert.ok(decodeURIComponent(th.url.split('text=')[1].split('&url=')[0]).startsWith('이 게시물은 쿠팡 파트너스'));
  assert.ok(P.instagramText(d, prog).startsWith('이 게시물은 쿠팡 파트너스'));
  assert.ok(!P.threadsShare({ ...P.EXAMPLE, program_ids: ['naver_adpost'] }, prog).added);
});

test('DB 오류 문구와 기타 도우미', () => {
  assert.equal(P.dbMsg({ code: 'tool_error', message: '{"error":{"message":"Failed to run sql query: ERROR:  P0001: job is not pending (already started or finished)"}}' }), '다른 곳에서 이미 처리 중이거나 끝난 요청이야.');
  assert.ok(P.dbMsg({ code: 'tool_error', message: 'ERROR: incompatible: Google 애드센스 × 쓰레드 (이유)' }).includes('Google 애드센스 × 쓰레드'));
  assert.equal(P.nextRunText({ h: 7, m: 0 }), '오늘 오전 8:51');
  assert.equal(P.nextRunText({ h: 12, m: 51 }), '오늘 오후 6:51');
  assert.equal(P.nextRunText({ h: 19, m: 0 }), '내일 오전 8:51');
  assert.equal(P.firstChars('😀가나다', 2), '😀가');
  assert.ok(!P.typeOkHere('comparison', { products: [] }) && !P.typeOkHere('news_summary', {}));
  assert.ok(P.typeOkHere('comparison', { products: [{ name: 'a', specs: [{ name: 'x', value: 'y' }] }, { name: 'b', pros: 'p' }] }));
  assert.ok(!P.typeOkHere('experience_review', {}) && P.typeOkHere('experience_review', { experience: true }));
  assert.ok(P.VAGUE_DISCLOSURE.test('수수료를 제공받을 수 있습니다'));
});
