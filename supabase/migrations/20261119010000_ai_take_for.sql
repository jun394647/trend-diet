-- 서버(디스코드 봇, 예약 작업)가 특정 사용자의 AI 사용 횟수를 차감할 때 쓴다.
-- 로그인 토큰이 없는 경로라 ai_take()를 쓸 수 없어서 따로 둔다. 서비스 키로만 부를 수 있다.
create function public.ai_take_for(p_user uuid, p_limit integer) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 500);
  v_count integer;
begin
  if p_user is null then
    raise exception 'user required';
  end if;
  insert into public.ai_usage as u (user_id, day, count)
  values (p_user, v_day, 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < v_limit
  returning u.count into v_count;
  if v_count is null or v_count > v_limit then
    return -1;
  end if;
  return v_count;
end;
$$;

revoke all on function public.ai_take_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_take_for(uuid, integer) to service_role;

-- 서버가 서비스 키로 기록을 읽고 쓸 수 있게 한다(행 수준 보안은 서비스 키에 적용되지 않는다).
grant select, insert, update on public.records to service_role;
grant select, insert, update on public.ai_usage to service_role;
