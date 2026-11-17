-- 기기 간 동기화를 위한 단일 테이블.
-- 앱의 모든 기록(프로필, 체중, 식사, 즐겨찾기, 체크인)을 (종류, 키) 단위의 JSON으로 저장한다.
-- 삭제는 행을 지우지 않고 deleted = true 로 표시해 다른 기기에도 전달되게 한다.

create table public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('profile', 'weight', 'meal', 'favorite', 'checkin')),
  key text not null check (char_length(key) between 1 and 80),
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

create index records_user_updated_idx on public.records (user_id, updated_at);

-- 변경 시각은 기기 시계가 아니라 서버 시계로 찍는다.
create function public.records_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger records_touch
before insert or update on public.records
for each row execute function public.records_touch();

alter table public.records enable row level security;

-- 로그인한 사용자는 자기 행만 읽고 쓸 수 있다.
create policy "own rows: select" on public.records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.records
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.records from anon;
grant select, insert, update on public.records to authenticated;
