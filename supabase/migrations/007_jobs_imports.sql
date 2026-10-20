-- 007: 작업 다시 하기·취소, 실적 파일 올리기(중복은 건너뜀)

create or replace function public.job_retry(job uuid) returns void
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set status = 'pending', note = '', started_at = null, done_at = null
    where id = job and status in ('failed','cancelled') returning * into r;
  if r.id is null then raise exception 'job cannot be retried'; end if;
  if r.kind = 'write' and r.post_id is not null then
    update public.posts set stage = 'queued', error = '' where id = r.post_id and stage in ('failed','verify');
  end if;
end $$;

create or replace function public.post_retry(target uuid) returns uuid
language plpgsql set search_path = '' as $$
declare p public.posts; j uuid;
begin
  select * into p from public.posts where id = target and deleted_at is null;
  if p.id is null then raise exception 'post not found'; end if;
  if p.stage not in ('failed','verify') then raise exception 'post is not failed (stage %)', p.stage; end if;
  select id into j from public.requests where post_id = target and kind = 'write' and status in ('failed','cancelled')
    order by created_at desc limit 1;
  if j is not null then
    perform public.job_retry(j);
    update public.requests set exp = p.experience, style = p.content_type where id = j;
    return j;
  end if;
  insert into public.requests (keyword, style, money, platform, len, exp, status, post_id, kind)
    values (p.keyword, p.content_type, p.money, p.platform, p.len, p.experience, 'pending', target, 'write')
    returning id into j;
  update public.posts set stage = 'queued', error = '' where id = target;
  return j;
end $$;

create or replace function public.job_cancel(job uuid) returns void
language plpgsql set search_path = '' as $$
declare r public.requests;
begin
  update public.requests set status = 'cancelled', done_at = now()
    where id = job and status = 'pending' and (started_at is null or started_at < now() - interval '30 minutes')
    returning * into r;
  if r.id is null then raise exception 'job cannot be cancelled'; end if;
  if r.kind = 'write' and r.post_id is not null then
    update public.posts set stage = 'failed', error = '요청을 취소했어' where id = r.post_id and stage in ('queued','verify','failed');
  end if;
end $$;

create or replace function public.import_metrics(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  imp public.imports;
  r jsonb;
  k text;
  n_ok int := 0;
  n_dup int := 0;
  pid uuid;
begin
  select * into imp from public.imports where id = p_import and status = '완료';
  if imp.id is null then raise exception 'import not found'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    pid := case when coalesce(r->>'post_id', '') ~ '^[0-9a-f-]{36}$' then (r->>'post_id')::uuid end;
    if pid is not null and not exists (select 1 from public.posts p where p.id = pid) then pid := null; end if;
    k := md5(concat_ws('|', imp.source_label, coalesce(imp.program_id, ''), coalesce(imp.channel_id, ''),
                       coalesce(pid::text, r->>'match_text', ''), r->>'period_start', r->>'period_end',
                       coalesce(r->>'views', ''), coalesce(r->>'impressions', ''), coalesce(r->>'clicks', ''),
                       coalesce(r->>'orders', ''), coalesce(r->>'cancels', ''), coalesce(r->>'revenue_est', ''),
                       coalesce(r->>'revenue_confirmed', ''), coalesce(r->>'revenue_paid', ''), coalesce(r->>'cost', '')));
    insert into public.metrics (post_id, channel_id, program_id, period_start, period_end, views, impressions, clicks, orders,
                                cancels, revenue_est, revenue_confirmed, revenue_paid, cost, source, source_label, import_id,
                                row_key, note)
    values (pid, imp.channel_id, imp.program_id, (r->>'period_start')::date, (r->>'period_end')::date,
            (r->>'views')::int, (r->>'impressions')::int, (r->>'clicks')::int, (r->>'orders')::int, (r->>'cancels')::int,
            (r->>'revenue_est')::numeric, (r->>'revenue_confirmed')::numeric, (r->>'revenue_paid')::numeric, (r->>'cost')::numeric,
            'csv', imp.source_label, p_import, k,
            case when pid is null and coalesce(r->>'match_text', '') <> '' then '글 연결 안 됨: ' || left(r->>'match_text', 200) else '' end)
    on conflict (row_key) where row_key is not null do nothing;
    if found then
      n_ok := n_ok + 1;
      if pid is not null then
        update public.posts set stage = 'collecting' where id = pid and stage = 'published';
      end if;
    else
      n_dup := n_dup + 1;
    end if;
  end loop;
  update public.imports set rows_ok = rows_ok + n_ok, rows_dup = rows_dup + n_dup where id = p_import;
  return jsonb_build_object('ok', n_ok, 'dup', n_dup);
end $$;

revoke execute on function public.job_retry(uuid), public.post_retry(uuid), public.job_cancel(uuid), public.import_metrics(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.job_retry(uuid), public.post_retry(uuid), public.job_cancel(uuid), public.import_metrics(uuid, jsonb)
  to service_role;
