// 서버 1.8.0 홈판 기록: 글마다 posts.feed_log (누락 확인·7일째 숫자·썸네일 변형·제목 글자 수), 설정 ai_citations (AI 브리핑 누적 인용 수)
// 서버 실제 코드를 Deno로 띄우고 가짜 DB API(harness.mjs)로 확인. DB 022 전(pre022)·후 둘 다
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HAS_DENO, SKIP as skip, startServer, pg } from './harness.mjs';

const POST = '12121212-1212-4121-8121-121212121212';
const body = '[이미지: (썸네일) 거실 가습기 고르기]\n> 핵심: 세척부터 봐요.\n## 소제목\n' + '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(20);
const mkState = () => ({
  pre022: false,
  posts: { [POST]: { id: POST, stage: 'published', source: 'auto', plan_kind: 'adpost', keyword: '거실 가습기 세척', titles: ['거실 가습기 고르기, 세척 쉬운 3가지 기준'], body, channel_id: 'naver_blog', program_ids: [], feed_log: { thumb: 'A' }, deleted_at: null } },
  settings: { id: 1, per_day: 1, auto_enabled: true, ai_citations: [] },
});
let db = mkState();
let srv;
const idOf = (q) => String(q.id || '').replace(/^eq\./, '');
const handle = ({ method, table, one, body: b, query }) => {
  if (table === 'posts' && method === 'GET') {
    const id = idOf(query);
    const strip = (p) => { if (!db.pre022) return p; const { feed_log, ...rest } = p; return rest; };
    return id ? [200, one ? (db.posts[id] ? strip(db.posts[id]) : null) : (db.posts[id] ? [strip(db.posts[id])] : [])] : [200, Object.values(db.posts).map(strip)];
  }
  if (table === 'posts' && method === 'PATCH') {
    if (db.pre022 && 'feed_log' in b) return pg.noColumn('feed_log', 'posts');
    const p = db.posts[idOf(query)];
    Object.assign(p, b);
    return [200, one ? p : [p]];
  }
  if (table === 'settings') {
    if (method === 'PATCH') {
      if (db.pre022 && 'ai_citations' in b) return pg.noColumn('ai_citations', 'settings');
      Object.assign(db.settings, b);
    }
    return [200, one ? db.settings : [db.settings]];
  }
  return undefined;
};

before(async () => { if (!HAS_DENO) return; srv = await startServer(handle); });
after(() => srv?.stop());

describe('022 뒤', () => {
  before(() => { db = mkState(); });
  test('홈판 기록: 보낸 칸만 바꾸고(빈 값은 지움), 다른 칸·단계는 그대로', { skip }, async () => {
    const r = await srv.call('POST', `posts/${POST}`, { feed_log: { checked_on: '2026-11-08', indexed: 'yes', feed_pct: 62.5, views_7d: 480, avg_secs: 95, title_len: 24, note: '  홈판 첫 유입  ' } });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.deepEqual(db.posts[POST].feed_log, { thumb: 'A', checked_on: '2026-11-08', indexed: 'yes', feed_pct: 62.5, views_7d: 480, avg_secs: 95, title_len: 24, note: '홈판 첫 유입' });
    assert.equal(db.posts[POST].stage, 'published', '기록은 단계를 안 바꿈');
    const w = srv.calls.filter((c) => c.table === 'posts' && c.method === 'PATCH').pop();
    assert.deepEqual(Object.keys(w.body), ['feed_log'], '기록 말고 다른 칸은 안 보냄');
    const r2 = await srv.call('POST', `posts/${POST}`, { feed_log: { thumb: 'C', note: '' } });
    assert.equal(r2.status, 200);
    assert.equal(db.posts[POST].feed_log.thumb, 'C');
    assert.ok(!('note' in db.posts[POST].feed_log), '빈 값은 그 칸을 지움 (데이터 없음)');
  });
  test('이상한 값은 그 칸 이름으로 거절 (저장 안 함)', { skip }, async () => {
    const before = JSON.stringify(db.posts[POST].feed_log);
    for (const [log, field] of [[{ feed_pct: 120 }, 'feed_log.feed_pct'], [{ thumb: 'D' }, 'feed_log.thumb'], [{ token: 'x' }, 'feed_log.token'], [[1], 'feed_log'], [{ checked_on: '어제' }, 'feed_log.checked_on']]) {
      const r = await srv.call('POST', `posts/${POST}`, { feed_log: log });
      assert.deepEqual([r.status, r.j], [400, { error: 'bad_field', field }], JSON.stringify(log));
    }
    assert.equal(JSON.stringify(db.posts[POST].feed_log), before);
  });
  test('AI 브리핑 인용 수: 같은 날은 나중 값, 날짜 순, 이상한 값은 거절', { skip }, async () => {
    const s = await srv.call('POST', 'settings', { ai_citations: [{ on: '2026-11-16', total: 5 }, { on: '2026-11-09', total: 2 }, { on: '2026-11-16', total: 7 }] });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.deepEqual(db.settings.ai_citations, [{ on: '2026-11-09', total: 2 }, { on: '2026-11-16', total: 7 }]);
    const bad = await srv.call('POST', 'settings', { ai_citations: [{ on: '2026-11-16', total: -1 }] });
    assert.deepEqual([bad.status, bad.j], [400, { error: 'bad_field', field: 'ai_citations' }]);
  });
});

describe('022 전 DB', () => {
  before(() => { db = mkState(); db.pre022 = true; });
  test('홈판 기록은 DB 업데이트(022) 필요, 인용 수는 건너뛰고 다른 설정은 저장', { skip }, async () => {
    const r = await srv.call('POST', `posts/${POST}`, { feed_log: { indexed: 'no' } });
    assert.deepEqual([r.status, r.j], [409, { error: 'db_update_needed', migration: '022' }]);
    const s = await srv.call('POST', 'settings', { per_day: 2, ai_citations: [{ on: '2026-11-09', total: 1 }] });
    assert.equal(s.status, 200, JSON.stringify(s.j));
    assert.deepEqual(s.j.skipped, ['ai_citations']);
    assert.equal(db.settings.per_day, 2);
  });
});
