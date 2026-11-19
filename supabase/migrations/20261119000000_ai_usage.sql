-- AI 기능의 하루 사용 횟수. 서버 함수가 Claude를 부르기 전에 ai_take()로 한 번씩 차감한다.
create table public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

create policy "own usage: select" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- 오늘 사용 횟수를 1 올리고, 한도 안이면 올린 뒤의 횟수를, 한도를 넘으면 -1을 돌려준다.
-- 표에는 직접 쓸 수 없고 이 함수로만 올릴 수 있다. 횟수를 내리는 방법은 없다.
create function public.ai_take(p_limit integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 500);
  v_count integer;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  insert into public.ai_usage as u (user_id, day, count)
  values (v_user, v_day, 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < v_limit
  returning u.count into v_count;
  if v_count is null or v_count > v_limit then
    return -1;
  end if;
  return v_count;
end;
$$;

revoke all on function public.ai_take(integer) from public, anon;
grant execute on function public.ai_take(integer) to authenticated;
