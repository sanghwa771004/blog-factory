// 테스트용 DB: PGlite(브라우저·Node에서 도는 진짜 Postgres)에 저장소의 마이그레이션을 순서대로 적용
// Supabase 전용인 pg_net(002)만 건너뜀. anon/authenticated/service_role 역할은 미리 만들어 둠.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();

// before: { '005': async (db) => {...} } — 그 번호 마이그레이션 직전에 실행 (예전 데이터 넣기)
export async function freshDb({ upTo = null, before = {} } = {}) {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $$;`);
  for (const f of migrationFiles()) {
    const num = f.slice(0, 3);
    if (upTo && num > upTo) break;
    if (before[num]) await before[num](db);
    if (num === '002') continue; // pg_net: Supabase 전용 확장
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

export const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
export const all = async (db, sql, params) => (await db.query(sql, params)).rows;
export const val = async (db, sql, params) => { const r = await one(db, sql, params); return r ? Object.values(r)[0] : undefined; };
export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const longBody = (extra = '') => '## 소제목\n' + '원룸에서 쓰기 좋은 기준을 정리했어요. '.repeat(12) + '\n' + extra;
