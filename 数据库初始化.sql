-- ===================================================================
-- CS2 校园杯 · CloudBase PostgreSQL 初始化 / 安全迁移
-- 在 CloudBase 控制台的 PostgreSQL SQL 编辑器执行；可重复执行。
--
-- 首次启用后台前：先在「身份认证」创建管理员账号，然后把该账号的
-- UID 插入 public.cs2cup_admin（见文件末尾的单独 INSERT 示例）。
-- 未加入白名单的已登录账号没有任何后台写权限。
-- ===================================================================

-- ---------- 1. 业务表 ----------
create table if not exists public.event (
  id         bigint generated always as identity primary key,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- team 保存完整报名资料（包括联系方式），只允许管理员读取。
create table if not exists public.team (
  id         bigint generated always as identity primary key,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- team_public 只保存公开展示字段；访客绝不会直接读取 team。
create table if not exists public.team_public (
  id         bigint primary key references public.team(id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gallery (
  id         bigint generated always as identity primary key,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 管理员白名单由 SQL 控制台维护，前端用户不能自行写入。
-- 不建立到 auth.users 的外键：CloudBase 环境的 users.id 类型并不固定，
-- 而 RLS 只需将此文本 UID 与 auth.uid() 比较。
create table if not exists public.cs2cup_admin (
  user_id    text primary key,
  created_at timestamptz not null default now()
);

-- ---------- 2. 管理员与公开资料同步函数 ----------
create or replace function public.cs2cup_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'authenticated'
     and exists (
       select 1 from public.cs2cup_admin a
       where a.user_id = auth.uid()
     );
$$;

-- 旧版开放写入期间可能已留下非数字 seed/teamCap；安全迁移不能因此中断。
create or replace function public.cs2cup_safe_int(p_value text)
returns integer
language plpgsql
immutable
as $$
begin
  return p_value::integer;
exception when others then
  return null;
end;
$$;

-- 修改私有报名表时，同步剥离 captain/contact/note 后的公开副本。
create or replace function public.cs2cup_sync_team_public()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.team_public where id = old.id;
    return old;
  end if;

  insert into public.team_public (id, data, created_at)
  values (
    new.id,
    new.data - array['captain', 'contact', 'note']::text[],
    new.created_at
  )
  on conflict (id) do update
    set data = excluded.data,
        created_at = excluded.created_at;
  return new;
end;
$$;

drop trigger if exists cs2cup_team_public_sync on public.team;
create trigger cs2cup_team_public_sync
after insert or update or delete on public.team
for each row execute function public.cs2cup_sync_team_public();

-- 迁移旧数据；已有完整报名资料会继续保留在 private team 表中。
insert into public.team_public (id, data, created_at)
select id, data - array['captain', 'contact', 'note']::text[], created_at
from public.team
on conflict (id) do update
  set data = excluded.data,
      created_at = excluded.created_at;

-- ---------- 3. 受控的匿名报名入口 ----------
-- CloudBase 的 RPC 端点可被所有角色访问；因此此 SECURITY DEFINER
-- 函数必须自行限制调用者角色。函数在单个数据库事务中运行。
create or replace function public.cs2cup_submit_team(p_team jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event      jsonb;
  v_name       text;
  v_tag        text;
  v_captain    text;
  v_contact    text;
  v_dept       text;
  v_note       text;
  v_players    jsonb;
  v_cap        integer := 16;
  v_count      integer := 0;
  v_seed       integer;
  v_deadline   timestamptz;
  v_id         bigint;
begin
  if auth.role() <> 'anon' then
    raise exception '只允许未登录访客提交报名' using errcode = '42501';
  end if;
  if jsonb_typeof(p_team) <> 'object' then
    raise exception '报名数据格式无效';
  end if;

  v_name := btrim(coalesce(p_team ->> 'name', ''));
  v_tag := upper(btrim(coalesce(p_team ->> 'tag', '')));
  v_captain := btrim(coalesce(p_team ->> 'captain', ''));
  v_contact := btrim(coalesce(p_team ->> 'contact', ''));
  v_dept := btrim(coalesce(p_team ->> 'dept', ''));
  v_note := btrim(coalesce(p_team ->> 'note', ''));

  if char_length(v_name) not between 1 and 80
     or char_length(v_tag) not between 2 and 24
     or char_length(v_captain) not between 1 and 80
     or char_length(v_contact) not between 1 and 128
     or char_length(v_dept) > 100
     or char_length(v_note) > 500 then
    raise exception '报名字段长度或必填项无效';
  end if;
  if jsonb_typeof(p_team -> 'players') <> 'array'
     or jsonb_array_length(p_team -> 'players') not between 1 and 6 then
    raise exception '请填写 1 至 6 名队员';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_team -> 'players') as player(value)
    where char_length(btrim(value)) not between 1 and 80
  ) then
    raise exception '队员昵称长度无效';
  end if;
  select jsonb_agg(to_jsonb(btrim(value))) into v_players
  from jsonb_array_elements_text(p_team -> 'players') as player(value);

  -- 把所有报名串行化，避免并发请求获得同一名额或种子。
  perform pg_advisory_xact_lock(hashtext('cs2cup:team-registration'));
  select data into v_event from public.event order by id desc limit 1;
  if v_event is not null then
    begin
      v_cap := greatest(2, least(128, coalesce(public.cs2cup_safe_int(v_event ->> 'teamCap'), 16)));
    exception when others then
      raise exception '赛事名额配置无效';
    end;
    begin
      v_deadline := nullif(v_event ->> 'regDeadline', '')::timestamptz;
    exception when others then
      raise exception '报名截止时间配置无效';
    end;
  end if;
  if v_deadline is not null and now() >= v_deadline then
    raise exception '报名已截止';
  end if;

  select count(*) into v_count from public.team;
  if v_count >= v_cap then
    raise exception '报名名额已满';
  end if;
  if exists (
    select 1 from public.team
    where lower(btrim(data ->> 'tag')) = lower(v_tag)
       or btrim(data ->> 'name') = v_name
  ) then
    raise exception '战队名称或 TAG 已存在';
  end if;
  select s.seed into v_seed
  from generate_series(1, v_cap) as s(seed)
  where not exists (
    select 1 from public.team
    where coalesce(public.cs2cup_safe_int(data ->> 'seed'), 0) = s.seed
  )
  order by s.seed
  limit 1;
  if v_seed is null then
    raise exception '没有可用种子';
  end if;

  insert into public.team (data)
  values (jsonb_build_object(
    'seed', v_seed, 'name', v_name, 'tag', v_tag,
    'captain', v_captain, 'contact', v_contact,
    'dept', v_dept, 'players', v_players, 'note', v_note
  ))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 4. 表级授权与 RLS ----------
alter table public.event         enable row level security;
alter table public.team          enable row level security;
alter table public.team_public   enable row level security;
alter table public.gallery       enable row level security;
alter table public.cs2cup_admin  enable row level security;

revoke all on table public.event, public.team, public.team_public,
  public.gallery, public.cs2cup_admin from anon, authenticated;

grant select on public.event, public.team_public, public.gallery to anon, authenticated;
grant select, insert, update, delete on public.event, public.team, public.gallery to authenticated;
grant select on public.cs2cup_admin to authenticated;
grant usage, select on sequence public.event_id_seq, public.gallery_id_seq to authenticated;

drop policy if exists event_read on public.event;
drop policy if exists event_write on public.event;
drop policy if exists event_admin_write on public.event;
create policy event_read on public.event
  for select to anon, authenticated using (true);
create policy event_admin_write on public.event
  for all to authenticated
  using (public.cs2cup_is_admin())
  with check (public.cs2cup_is_admin());

drop policy if exists team_read on public.team;
drop policy if exists team_insert on public.team;
drop policy if exists team_update on public.team;
drop policy if exists team_delete on public.team;
drop policy if exists team_admin_read on public.team;
drop policy if exists team_admin_update on public.team;
drop policy if exists team_admin_delete on public.team;
create policy team_admin_read on public.team
  for select to authenticated using (public.cs2cup_is_admin());
create policy team_admin_update on public.team
  for update to authenticated
  using (public.cs2cup_is_admin())
  with check (public.cs2cup_is_admin());
create policy team_admin_delete on public.team
  for delete to authenticated using (public.cs2cup_is_admin());

drop policy if exists team_public_read on public.team_public;
create policy team_public_read on public.team_public
  for select to anon, authenticated using (true);

drop policy if exists gallery_read on public.gallery;
drop policy if exists gallery_write on public.gallery;
drop policy if exists gallery_admin_write on public.gallery;
create policy gallery_read on public.gallery
  for select to anon, authenticated using (true);
create policy gallery_admin_write on public.gallery
  for all to authenticated
  using (public.cs2cup_is_admin())
  with check (public.cs2cup_is_admin() and octet_length(data::text) <= 500000);

drop policy if exists cs2cup_admin_self_read on public.cs2cup_admin;
create policy cs2cup_admin_self_read on public.cs2cup_admin
  for select to authenticated using (user_id = (select auth.uid()));

-- 标准 PostgreSQL 权限仍保留；CloudBase RPC 的真正安全边界是上方函数内的角色校验。
revoke all on function public.cs2cup_submit_team(jsonb) from public;
grant execute on function public.cs2cup_submit_team(jsonb) to anon;
revoke all on function public.cs2cup_is_admin() from public;
revoke all on function public.cs2cup_sync_team_public() from public;

-- ---------- 5. 首次授权（仅执行一次） ----------
-- 1) 在 CloudBase「身份认证」中创建/确认管理员邮箱账号。
-- 2) 从用户管理中复制该用户 UID。
-- 3) 替换并执行下一行；不要把 UID 写进前端 config.js。
-- insert into public.cs2cup_admin (user_id) values ('替换为管理员 UID') on conflict do nothing;
