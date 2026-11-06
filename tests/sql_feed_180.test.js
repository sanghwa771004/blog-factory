// 022 홈판 기록 (1.8.0): posts.feed_log · settings.ai_citations — 진짜 Postgres(PGlite). 실행: npm test
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, one, val, longBody, MIGRATIONS_DIR } from './helpers/db.js';

const M022 = readFileSync(join(MIGRATIONS_DIR, '022_feed_log_1_8_0.sql'), 'utf8');
const errOf = async (p) => { try { await p; return 'ok'; } catch (e) { return String(e.message); } };

describe('022 적용: 홈판 기록 칸 (예전 원고·설정은 그대로)', () => {
  test('021 DB에 022를 두 번 올려도 같고, 예전 원고는 빈 기록 {} · 설정은 빈 인용 목록 []', async () => {
    const db = await freshDb({ upTo: '021' });
    const old = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source) values ('예전 원고', $1, '["예전"]', 'published', 'naver_blog', 'auto') returning id`, [longBody()]);
    const before = await one(db, `select keyword, body, titles, stage from public.posts where id = $1`, [old]);
    await db.exec(M022);
    await db.exec(M022);
    assert.deepEqual(await one(db, `select keyword, body, titles, stage from public.posts where id = $1`, [old]), before, '마이그레이션은 원고를 바꾸지 않음');
    assert.deepEqual(await one(db, `select feed_log from public.posts where id = $1`, [old]), { feed_log: {} });
    assert.deepEqual(await one(db, `select ai_citations from public.settings where id = 1`), { ai_citations: [] });
  });
  test('모양 검사: feed_log 는 객체, ai_citations 는 배열만', async () => {
    const db = await freshDb();
    const id = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id) values ('글', $1, '["제목"]', 'review', 'naver_blog') returning id`, [longBody()]);
    await db.query(`update public.posts set feed_log = '{"thumb": "B", "feed_pct": 40, "checked_on": "2026-11-08", "indexed": "yes"}' where id = $1`, [id]);
    assert.equal((await one(db, `select feed_log->>'thumb' as t from public.posts where id = $1`, [id])).t, 'B');
    assert.match(await errOf(db.query(`update public.posts set feed_log = '[]' where id = $1`, [id])), /posts_feed_log_shape/);
    await db.query(`update public.settings set ai_citations = '[{"on": "2026-11-09", "total": 3}]' where id = 1`);
    assert.match(await errOf(db.query(`update public.settings set ai_citations = '{}' where id = 1`)), /settings_ai_citations_shape/);
  });
  test('기록을 넣어도 단계·지운 날은 그대로 (본문 칸이 아님)', async () => {
    const db = await freshDb();
    const id = await val(db, `insert into public.posts (keyword, body, titles, stage, channel_id, source) values ('글', $1, '["제목"]', 'published', 'naver_blog', 'manual') returning id`, [longBody()]);
    await db.query(`update public.posts set feed_log = '{"views_7d": 120}' where id = $1`, [id]);
    assert.deepEqual(await one(db, `select stage, deleted_at from public.posts where id = $1`, [id]), { stage: 'published', deleted_at: null });
  });
});
