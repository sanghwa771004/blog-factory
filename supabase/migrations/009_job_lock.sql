-- 009: 작업 잠금 고침 (1.1.1)
-- 문제: job_start 가 '대기(pending)' 상태만 보고 잡아서, 자동 작가가 두 번 겹쳐 돌면(예약 실행 + 수동 실행)
--       같은 작업을 둘 다 잡을 수 있었음 → 원고는 써졌는데 요청은 '실패'로 남는 경우가 생김.
-- 고침: 이미 누가 잡은 작업(started_at 이 30분 안)은 다시 잡지 않음. 30분이 넘으면 멈춘 걸로 보고 다시 잡을 수 있음.
create or replace function public.job_start(job uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set started_at = now(), attempts = attempts + 1
    where id = job and status = 'pending'
      and (started_at is null or started_at < now() - interval '30 minutes')
    returning * into r;
  if r.id is null then raise exception 'job is not pending (already started or finished)'; end if;
  if r.kind = 'write' and r.post_id is not null then
    update public.posts set stage = 'writing', error = '' where id = r.post_id and stage in ('queued','failed','verify','researching','writing');
  end if;
  return to_jsonb(r);
end $$;

revoke execute on function public.job_start(uuid) from public, anon, authenticated;
