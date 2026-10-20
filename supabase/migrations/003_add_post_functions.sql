create or replace function public.next_free_date(start_day date) returns date
language sql
stable
set search_path = ''
as $$
  select d::date
  from generate_series(start_day::timestamp, (start_day + 730)::timestamp, interval '1 day') as d
  where (select count(*) from public.posts p where p.publish_date = d::date)
        < (select coalesce(s.per_day, 1) from public.settings s where s.id = 1)
  order by d
  limit 1
$$;

create or replace function public.add_post(p jsonb, start_offset int default 1)
returns table (post_id uuid, publish_date date)
language plpgsql
set search_path = ''
as $$
declare
  kst_today date := (now() at time zone 'Asia/Seoul')::date;
  d date;
  new_id uuid;
  req uuid := nullif(p ->> 'request_id', '')::uuid;
begin
  if length(coalesce(p ->> 'body', '')) < 50 then
    raise exception 'body is required';
  end if;
  d := public.next_free_date(kst_today + greatest(coalesce(start_offset, 1), 0));
  insert into public.posts (keyword, money, platform, style, len, titles, body, hashtags, threads, instagram, link, publish_date, source, request_id)
  values (
    coalesce(p ->> 'keyword', ''),
    coalesce(nullif(p ->> 'money', ''), '쿠팡파트너스'),
    coalesce(nullif(p ->> 'platform', ''), '네이버 블로그'),
    coalesce(p ->> 'style', ''),
    coalesce(nullif(p ->> 'len', ''), '2500'),
    case when jsonb_typeof(p -> 'titles') = 'array' then p -> 'titles' else '[]'::jsonb end,
    p ->> 'body',
    case when jsonb_typeof(p -> 'hashtags') = 'array' then p -> 'hashtags' else '[]'::jsonb end,
    coalesce(p ->> 'threads', ''),
    coalesce(p ->> 'instagram', ''),
    coalesce(p ->> 'link', ''),
    d,
    coalesce(nullif(p ->> 'source', ''), 'auto'),
    req
  )
  returning id into new_id;
  if req is not null then
    update public.requests r set status = 'done', post_id = new_id, done_at = now(), note = '' where r.id = req;
  end if;
  return query select new_id, d;
end
$$;

revoke execute on function public.next_free_date(date) from public, anon, authenticated;
revoke execute on function public.add_post(jsonb, int) from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
