// Claude 안 글공장(claude-artifact/blog-factory.html)의 계산 부분 테스트
// 페이지 안 /*PURE-START*/ ~ /*PURE-END*/ 사이 코드만 꺼내서 돌려 (화면·Claude 연결 없이)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../claude-artifact/blog-factory.html', import.meta.url), 'utf8');
const pure = html.match(/\/\*PURE-START\*\/([\s\S]*?)\/\*PURE-END\*\//)[1];
const NAMES = ['parseBody', 'quickCheck', 'normalizePost', 'normalizeTopics', 'normalizeVariants', 'sqlRows', 'dq', 'topicScore',
  'buildWritePrompt', 'buildTopicPrompt', 'buildReformatPrompt', 'exportHtml', 'exportPlain', 'threadsShare', 'instagramText',
  'disclosureFor', 'typeOkHere', 'dbMsg', 'nextRunText', 'EXAMPLE', 'firstChars', 'VAGUE_DISCLOSURE', 'isFakeExperience', 'withSnsDisclosure', 'subCategory'];
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

test('주제 카테고리가 블로그 주력 주제 이름 그대로면 비움 — 주제 추천 결과·주제로 원고 쓰기 (1.3.1)', () => {
  assert.equal(P.subCategory('계절템·겨울 가전', '계절템·겨울 가전'), '');
  assert.equal(P.subCategory('전기요', '계절템·겨울 가전'), '전기요');
  assert.equal(P.subCategory('', '계절템·겨울 가전'), '');
  assert.equal(P.subCategory('디지털', ''), '디지털');
  const o = { channels: cat.channels, programs: cat.programs, compat: cat.compat, channelId: 'naver_blog', category: '겨울 가전', focus: '겨울 가전', hasPerf: false };
  const nt = P.normalizeTopics([{ title: 'a', category: '겨울 가전' }, { title: 'b', category: '전기요' }, { title: 'c' }], o);
  assert.deepEqual(nt.map((t) => t.category), ['', '전기요', ''], 'AI가 주력 주제 이름을 카테고리로 돌려줘도 비움');
  assert.equal(P.normalizeTopics([{ title: 'c' }], { ...o, category: '디지털' })[0].category, '디지털', '요청한 카테고리가 주력 주제와 다르면 그대로');
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

test('검색 노출 (1.3.0·1.3.1): 블로그 원고는 첫 부분 [내 경험] 1곳·(직접 찍기) 사진 1곳·링크 2곳까지, 주제는 2~4주 뒤 시즌·주력 주제 안에서', () => {
  const wp = P.buildWritePrompt({ keyword: '원룸 창문 결로 막는 법', channel: ch.naver_blog, programs: [prog.coupang_partners], contentType: '', len: '2500', products: [], recent: [], today: '2026-10-25', allowed: ['problem_solving'], focus: '계절템·겨울 가전' });
  assert.ok(wp.includes('첫 소제목 부분에') && wp.includes('[내 경험:') && wp.includes('꼭 1곳'), '경험 자리');
  assert.ok(wp.includes('[이미지: (직접 찍기)'), '직접 찍을 사진 자리');
  assert.ok(wp.includes('첫 소제목 앞에는 넣지 마') && wp.includes('2곳까지'), '링크 위치');
  assert.ok(wp.includes('틀에 박힌 말'));
  // 1.3.1: 카테고리를 주력 주제 이름으로 채우지 않고, 키워드·제목에 주제 낱말이 드러나게
  assert.ok(!wp.includes('- 카테고리: 계절템·겨울 가전') && wp.includes('세부 분류') && wp.includes('- 블로그 주력 주제: 계절템·겨울 가전') && wp.includes('키워드나 제목에 주력 주제 낱말'), '카테고리와 주력 주제를 구분');
  const wt = P.buildWritePrompt({ keyword: 'x y z', channel: ch.naver_blog, programs: [], contentType: 'how_to', products: [], recent: [], today: '2026-10-26', allowed: ['how_to'], focus: '겨울 가전', focusTerms: '전기요, 온수매트', category: '온수매트' });
  assert.ok(wt.includes('- 카테고리: 온수매트') && wt.includes('주제 낱말: 전기요, 온수매트'));
  const withExp = P.buildWritePrompt({ keyword: 'x y z', channel: ch.naver_blog, programs: [], contentType: 'how_to', experience: '6평 원룸, 북향 창', products: [], recent: [], today: '2026-10-25', allowed: ['how_to'] });
  assert.ok(!withExp.includes('꼭 1곳') && withExp.includes('6평 원룸, 북향 창') && !withExp.includes('[링크: 버튼 문구]'));
  const sns = P.buildWritePrompt({ keyword: 'x', channel: ch.threads, programs: [], contentType: 'sns_short', products: [], recent: [], today: '2026-10-25', allowed: ['sns_short'] });
  assert.ok(!sns.includes('(직접 찍기)') && !sns.includes('꼭 1곳'), 'SNS 글에는 사진·경험 자리를 강제하지 않음');
  const base = { count: 6, mode: 'category', channel: ch.naver_blog, programs: [], channels: cat.channels, allPrograms: cat.programs, compat: cat.compat, recent: [], perf: [], today: '2026-10-25' };
  const t1 = P.buildTopicPrompt({ ...base, category: '', focus: '계절템·겨울 가전' });
  assert.ok(t1.includes('2~4주 뒤') && t1.includes('- 카테고리: 계절템·겨울 가전 (블로그 주력 주제 — 이 안에서만)') && t1.includes('1~2단어 짧은 키워드'));
  assert.ok(t1.includes('keyword 나 title 에 주력 주제 낱말') && t1.includes('category 에는 세부 분류'), '주제 추천도 카테고리와 주력 주제를 구분');
  const t2 = P.buildTopicPrompt({ ...base, category: '디지털', focus: '계절템·겨울 가전' });
  assert.ok(t2.includes('- 카테고리: 디지털') && t2.includes('블로그 주력 주제: 계절템·겨울 가전'));
  const t3 = P.buildTopicPrompt({ ...base, category: '겨울 가전' });
  assert.ok(!t3.includes('주력 주제') && !/undefined/.test(t3));
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

test('1.1.2: 앱과 같은 규칙 — 안내 문장은 써본 척 아님, 애매한 고지 표현 확대, SNS 고지문은 항상 맨 앞', async () => {
  const app = await import('../checks.js');
  const samples = ['매장에서 직접 사용해 보면서 소음을 비교해 보세요.', '일주일 사용 중 고장이 나면 교환을 요청하세요.', '제가 한 달 동안 써보니 따뜻했어요.', '한 달 동안 써보니 좋았는데, 이런 경우 고려해 보세요.'];
  for (const s of samples) assert.equal(P.isFakeExperience(s), app.isFakeExperience(s), s);
  for (const t of ['수수료가 지급될 수 있습니다', '수수료가 발생할 수 있습니다', '받을 수 도 있어요', prog.coupang_partners.disclosure_template]) {
    assert.equal(P.VAGUE_DISCLOSURE.test(t), app.VAGUE_DISCLOSURE.test(t), t);
  }
  const d = prog.coupang_partners.disclosure_template;
  const t = P.withSnsDisclosure('본문\n\n' + d, ['coupang_partners'], prog);
  assert.ok(t.startsWith(d) && t.split(d).length === 2);
  const r = P.quickCheck({ ...P.EXAMPLE, body: P.EXAMPLE.body + '\n매장에서 직접 사용해 보면서 소음을 비교해 보세요.' }, C);
  assert.deepEqual(r.errors, [], '정보 글의 안내 문장은 막지 않음');
});

test('DB 오류 문구와 기타 도우미', () => {
  assert.ok(P.dbMsg({ code: 'tool_error', message: 'ERROR:  P0001: topic already has a post' }).includes('이미'));
  assert.equal(P.dbMsg({ code: 'tool_error', message: '{"error":{"message":"Failed to run sql query: ERROR:  P0001: job is not pending (already started or finished)"}}' }), '다른 곳에서 이미 처리 중이거나 끝난 요청이야.');
  assert.ok(P.dbMsg({ code: 'tool_error', message: 'ERROR: incompatible: Google 애드센스 × 쓰레드 (이유)' }).includes('Google 애드센스 × 쓰레드'));
  assert.equal(P.nextRunText({ h: 7, m: 0 }), '오늘 오전 8:51');
  // 1.6.0: 점심 실행이 오후 1:21 (예약 작업 두 개 — 8:51·18:51 + 13:21)
  assert.equal(P.nextRunText({ h: 12, m: 51 }), '오늘 오후 1:21');
  assert.equal(P.nextRunText({ h: 13, m: 21 }), '오늘 오후 6:51');
  assert.equal(P.nextRunText({ h: 19, m: 0 }), '내일 오전 8:51');
  assert.equal(P.firstChars('😀가나다', 2), '😀가');
  assert.ok(!P.typeOkHere('comparison', { products: [] }) && !P.typeOkHere('news_summary', {}));
  assert.ok(P.typeOkHere('comparison', { products: [{ name: 'a', specs: [{ name: 'x', value: 'y' }] }, { name: 'b', pros: 'p' }] }));
  assert.ok(!P.typeOkHere('experience_review', {}) && P.typeOkHere('experience_review', { experience: true }));
  assert.ok(P.VAGUE_DISCLOSURE.test('수수료를 제공받을 수 있습니다'));
});

// ───────── 1.7.0 전문성·사람 말투 ─────────
const P17 = new Function(pure + `\nreturn { parseBody, exportHtml, exportPlain, viewHtml, buildWritePrompt, buildPolishPrompt, normalizePolish, voiceCard, VOICE_PRESETS, AI_PHRASE_WORDS, markLines, isAppSlot, dbMsg };`)();

test('1.7.0 본문 형식: [기준]·[용어] 상자, 출처 번호 [^n], 앱이 그리는 사진 자리가 앱(checks.js)과 같게 읽힘', async () => {
  const app = await import('../checks.js');
  const body = '[이미지: (썸네일) 제목 카드]\n[프롬프트: 앱이 그리는 썸네일 — 제미나이 필요 없음]\n## 전기요 고를 때\n[기준: 2026년 11월 기준 · 참고: 한국전기안전공사]\n[용어: KC 인증 — 국가가 안전 기준을 확인했다는 표시]\n전기요는 KC 인증부터 봐요[^1].\n| 항목 | 볼 것 |\n|---|---|\n| 소재 | 세탁 |\n[이미지: (정보 카드) 고르는 기준 표]\n[프롬프트: 앱이 그리는 정보 카드 — 제미나이 필요 없음]';
  const mine = P17.parseBody(body).map((b) => [b.t, b.text || '', b.term || '']);
  const theirs = app.parseBody(body).map((b) => [b.t, b.text || '', b.term || '']);
  assert.deepEqual(mine, theirs);
  assert.deepEqual(mine.filter((b) => b[0] === 'basis' || b[0] === 'term'), [['basis', '2026년 11월 기준 · 참고: 한국전기안전공사', ''], ['term', '국가가 안전 기준을 확인했다는 표시', 'KC 인증']]);
  assert.ok(P17.isAppSlot('(썸네일) 제목 카드') && P17.isAppSlot('(정보 카드) 표') && !P17.isAppSlot('창가 제습기'));
  for (const t of ['(썸네일) 제목 카드', '(정보 카드) 표', '창가 제습기', ' (정보  카드) x']) assert.equal(P17.isAppSlot(t), app.isAppDrawnSlot(t), t);
  const d = { body, link: '', program_ids: [], sources: [{ title: '한국전기안전공사 안내', url: 'https://www.kesco.or.kr/', checked_at: '2026-11-02' }, { title: '', url: 'javascript:alert(1)' }] };
  const html = P17.exportHtml(d, prog);
  assert.ok(html.includes('📌 이 글의 기준') && html.includes('background-color:#f2f4f7') && html.includes('용어 풀이 · KC 인증') && html.includes('background-color:#eef3fb'));
  assert.ok(html.includes('<sup style="font-size:.72em;color:#888;">[1]</sup>'), '출처 번호는 작은 [1]');
  assert.ok(html.includes('<b>참고 자료</b>') && html.includes('[1] 한국전기안전공사 안내 (2026-11-02 확인)') && !html.includes('javascript:'), '참고 자료는 안전한 주소만');
  assert.ok(html.includes('여기에 앱에서 만든 썸네일 넣기') && html.includes('여기에 앱에서 만든 정보 카드 넣기') && !html.includes('제미나이 필요 없음'), '앱이 그리는 자리 안내, 프롬프트 줄은 빠짐');
  const plain = P17.exportPlain(d, prog);
  assert.ok(plain.includes('📌 이 글의 기준: 2026년 11월 기준') && plain.includes('※ 용어 풀이 · KC 인증: 국가가') && plain.includes('봐요[1].') && /참고 자료\n\[1\] 한국전기안전공사 안내 \(2026-11-02 확인\) https:\/\/www\.kesco\.or\.kr\//.test(plain));
  const view = P17.viewHtml(d);
  assert.ok(view.includes('class="basis"') && view.includes('class="term"') && view.includes('<sup class="fn">[1]</sup>') && view.includes('앱이 그려줘') && view.includes('class="srcs"'));
  assert.ok(!P17.exportHtml({ ...d, sources: [] }, prog).includes('참고 자료'), '출처가 없으면 목록도 없음');
});

test('1.7.0 말투 카드: 앱(checks.js)과 같은 기본 말투, 저장한 카드가 있으면 그 카드', async () => {
  const app = await import('../checks.js');
  for (const k of Object.keys(app.VOICE_PRESETS)) assert.equal(P17.VOICE_PRESETS[k].card, app.VOICE_PRESETS[k].card, k);
  assert.deepEqual(Object.keys(P17.VOICE_PRESETS), Object.keys(app.VOICE_PRESETS));
  const cases = [{}, { voice: { general: { preset: 'calm' } } }, { voice: { general: { preset: 'calm', card: '반말로 짧게 써.' } } }, { voice: { invest: { preset: 'friendly' } } }, { voice: { general: { preset: 'nope' } } }];
  for (const st of cases) for (const sc of ['general', 'invest']) assert.equal(P17.voiceCard(st, sc), app.voiceCard(st, sc), JSON.stringify(st) + sc);
  const wp = P17.buildWritePrompt({ keyword: '원룸 가습기 세척', channel: ch.naver_blog, programs: [prog.coupang_partners], contentType: '', len: '2500', products: [], recent: [], today: '2026-11-03', allowed: ['how_to'], voice: '반말로 짧게 써.' });
  assert.ok(wp.includes('- 말투 카드') && wp.includes('반말로 짧게 써.') && !/undefined|null/.test(wp));
  // 앱 'AI 말투 점수'가 잡는 말을 금지 목록으로, 전문가 틀([기준]·[용어]), 썸네일·정보 카드 자리
  for (const ph of ['알아보겠습니다', '결론적으로', '하는 것이 중요합니다', '다양한', '도움이 되셨기를', '많은 분들이']) assert.ok(wp.includes(ph), ph);
  assert.ok(wp.includes('[기준: 이 글의 기준 — 예: 2026년 11월 기준]') && wp.includes('[용어: 용어 — 한 줄 풀이]') && wp.includes('출처 번호'), '전문가 틀');
  assert.ok(wp.includes('[이미지: (썸네일) 썸네일 문구]') && wp.includes('[이미지: (정보 카드)') && wp.includes('깔끔한 일러스트'), '앱이 그리는 자리·일러스트 위주');
  // 1.8.0 홈판: 결론 맨 위 '> 핵심' 상자, 제목 25~40자·낚시 말 금지, 짧은 문단
  assert.ok(wp.includes('첫 소제목 앞에 \"> 핵심: 이 글의 답 한두 문장\" 상자를 꼭') && wp.includes('3개 모두 25~40자') && wp.includes('2~3문장(휴대폰 3~4줄)마다 끊어') && !wp.includes('마지막은 3줄 요약'), '1.8.0 홈판 규칙');
  const sns = P17.buildWritePrompt({ keyword: 'x', channel: ch.threads, programs: [], contentType: 'sns_short', products: [], recent: [], today: '2026-11-03', allowed: ['sns_short'], voice: '반말로 짧게 써.' });
  assert.ok(!sns.includes('- 말투 카드') && !sns.includes('[기준:') && !sns.includes('(썸네일)'), 'SNS 글은 블로그 틀을 강제하지 않음');
  // 문서(자동 작가 프롬프트)의 금지 목록과 같은 말
  const doc = readFileSync(new URL('../docs/auto-writer-prompt.md', import.meta.url), 'utf8');
  assert.ok(doc.includes(P17.AI_PHRASE_WORDS), '자동 작가 프롬프트 규칙 15와 같은 금지 목록');
});

test('1.7.0 말투 다듬기: 사진·링크 자리 줄이 그대로여야 저장, 제목은 고를 때만', () => {
  const old = '[이미지: (썸네일) 제목 카드]\n## 고를 때\n가습기는 세척이 쉬운 것이 중요합니다. 다양한 제품이 있습니다.\n[링크: 가격 보기]\n[이미지: 창가 가습기]';
  const good = '[이미지: (썸네일) 제목 카드]\n## 고를 때\n가습기는 세척이 쉬워야 오래 써요. 생각보다 종류가 많거든요.\n[링크: 가격 보기]\n[이미지: 창가 가습기]';
  assert.deepEqual(P17.normalizePolish({ body: good, titles: [] }, old), { body: good });
  assert.deepEqual(P17.normalizePolish({ body: good, titles: ['가습기 세척 쉬운 것 고르는 법', ''] }, old).titles, ['가습기 세척 쉬운 것 고르는 법']);
  assert.throws(() => P17.normalizePolish({ body: good.replace('[링크: 가격 보기]', '[링크: 최저가 보기]') }, old), (e) => e.code === 'marks_changed');
  assert.throws(() => P17.normalizePolish({ body: good.replace('[이미지: 창가 가습기]\n', '').replace('[링크: 가격 보기]', '[이미지: 창가 가습기]\n[링크: 가격 보기]') + '\n끝' }, old), (e) => e.code === 'marks_changed', '순서가 바뀌어도 거절');
  assert.throws(() => P17.normalizePolish({ body: '짧아' }, old), (e) => e.code === 'empty_completion');
  assert.throws(() => P17.normalizePolish([], old), (e) => e.code === 'invalid_json');
  assert.deepEqual(P17.markLines(' [이미지: a]\n본문\n[링크: b] \n[내 경험: c]'), ['[이미지: a]', '[링크: b]']);
  const pp = P17.buildPolishPrompt({ title: '가습기', body: old, voice: P17.VOICE_PRESETS.calm.card, note: '더 짧게' });
  assert.ok(pp.includes(P17.VOICE_PRESETS.calm.card) && pp.includes('[요청 메모 — 이것부터] 더 짧게') && pp.includes('글자 하나도 바꾸지 말고') && pp.includes(old) && !/undefined|null/.test(pp));
  assert.ok(P17.buildPolishPrompt({ title: '', body: old, voice: '', retry: true }).includes('지난번 답은 사진·링크 자리 줄이 바뀌어서'));
  assert.equal(P17.dbMsg({ code: 'tool_error', message: 'ERROR:  P0001: polish changed image or link lines' }), '사진·링크 자리 줄이 바뀌어서 앱이 저장하지 않았어. 다시 요청해줘.');
});

test('1.7.0 말투 다듬기 기준이 DB(set_polish)와 같음: 줄 앞뒤 공백만 무시하고 [이미지|링크]로 시작하는 줄을 순서대로 비교', () => {
  const M021 = readFileSync(new URL('../supabase/migrations/021_pro_voice_1_7_0.sql', import.meta.url), 'utf8');
  assert.ok(M021.includes("where btrim(l.t) ~ '^\\[(이미지|링크)'"), 'DB 기준');
  assert.ok(M021.includes("raise exception 'polish changed image or link lines'"));
  assert.match(html, /markLines = b => String\(b \|\| ""\)\.split\("\\n"\)\.map\(l => l\.trim\(\)\)\.filter\(l => \/\^\\\[\(이미지\|링크\)\/\.test\(l\)\)/);
});
