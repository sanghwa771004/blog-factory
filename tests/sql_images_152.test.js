// 019 같은 합성이 두 줄로 저장되지 않게 (1.5.2) — PGlite(진짜 Postgres)에 001~019 를 적용해서 확인. 실행: npm test
// 서버는 합성 저장 경로를 요청 번호로 정함 → 같은 요청이 거의 동시에 두 번 와도 살아 있는 합성은 한 줄만 (두 번째는 23505 → 서버가 먼저 저장된 줄을 돌려줌)
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, val, all, MIGRATIONS_DIR } from './helpers/db.js';

const SQL019 = readFileSync(join(MIGRATIONS_DIR, '019_composite_once_1_5_2.sql'), 'utf8');
// 시험용 줄 (018 검사: 합성은 composite_mode 'layer')
const ins = (db, kind, path) => db.exec(`insert into public.post_images (kind, provider, composite_mode, storage_path, mime, description)
  values ('${kind}', '${kind === 'composite' ? 'composite' : 'upload'}', '${kind === 'composite' ? 'layer' : ''}', '${path}', 'image/png', '시험');`);
const errCode = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || String(e.message); } };

describe('019 — 저장 경로가 같은 살아 있는 합성은 한 줄만', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('같은 경로의 두 번째 합성 줄은 DB가 막음 (23505), 지운(휴지통) 줄은 막지 않음, 다른 종류는 상관없음', async () => {
    await ins(db, 'composite', 'composite/2026/10/req_key_0001.png');
    assert.equal(await errCode(ins(db, 'composite', 'composite/2026/10/req_key_0001.png')), '23505');
    assert.equal(await val(db, `select count(*)::int from public.post_images where storage_path = 'composite/2026/10/req_key_0001.png'`), 1);
    // 지운 줄과 같은 경로는 괜찮음 (지운 합성의 파일은 이미 지워짐)
    await db.exec(`update public.post_images set deleted_at = now() where storage_path = 'composite/2026/10/req_key_0001.png'`);
    assert.equal(await errCode(ins(db, 'composite', 'composite/2026/10/req_key_0001.png')), 'ok');
    // 합성이 아닌 줄은 예전 그대로
    await ins(db, 'upload', 'upload/same.jpg');
    assert.equal(await errCode(ins(db, 'upload', 'upload/same.jpg')), 'ok');
  });

  test('다시 돌려도 같은 결과 (색인 하나)', async () => {
    await db.exec(SQL019);
    await db.exec(SQL019);
    const idx = await all(db, `select indexname from pg_indexes where tablename = 'post_images' and indexname = 'post_images_composite_path_uniq'`);
    assert.equal(idx.length, 1);
  });
});

describe('019 — 이미 같은 경로의 합성이 두 줄 있으면 고치지 않고 색인만 건너뜀', () => {
  test('데이터는 그대로, 색인 없음 (실패하지 않음)', async () => {
    const db = await freshDb({
      before: {
        '019': async (d) => {
          await ins(d, 'composite', 'composite/2026/10/dup_key_0001.png');
          await ins(d, 'composite', 'composite/2026/10/dup_key_0001.png');
        },
      },
    });
    assert.equal(await val(db, `select count(*)::int from public.post_images where storage_path = 'composite/2026/10/dup_key_0001.png' and deleted_at is null`), 2, '지우거나 고치지 않음');
    const idx = await all(db, `select indexname from pg_indexes where indexname = 'post_images_composite_path_uniq'`);
    assert.equal(idx.length, 0);
  });
});
