-- 1.1 작업 전 백업: 기존 표를 backup 스키마에 그대로 복사 (외부 접근 없음)
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table backup.posts_20261021 as table public.posts;
create table backup.requests_20261021 as table public.requests;
create table backup.settings_20261021 as table public.settings;
create table backup.runs_20261021 as table public.runs;
create table backup.app_access_20261021 as table public.app_access;
revoke all on all tables in schema backup from public, anon, authenticated;
