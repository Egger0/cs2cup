-- ===================================================================
--  CS2 校园杯 · 数据库初始化(PostgreSQL 版)
--  用法:CloudBase 控制台 → 数据库 → PostgreSQL → 「SQL 编辑器」
--        把本文件全部内容粘进去,点「运行」。跑一次即可(可重复运行)。
--
--  它会做三件事:
--    1. 建三张表:event(赛事信息)、team(报名战队)、gallery(往届赛事相册)
--    2. 打开行级安全(RLS)
--    3. 设权限:访客(anon)能看、能报名;管理员(登录后=authenticated)能改能删
-- ===================================================================

-- ---------- 1. 建表 ----------
-- 业务字段统一放在 data(jsonb)里,程序自己读写,不用你手动加列。
create table if not exists public.event (
  id         bigint generated always as identity primary key,
  data       jsonb        not null default '{}'::jsonb,
  created_at timestamptz  not null default now()
);

create table if not exists public.team (
  id         bigint generated always as identity primary key,
  data       jsonb        not null default '{}'::jsonb,
  created_at timestamptz  not null default now()
);

-- 往届赛事相册:每张照片一行。data 里放 { url, caption, edition, sort }
create table if not exists public.gallery (
  id         bigint generated always as identity primary key,
  data       jsonb        not null default '{}'::jsonb,
  created_at timestamptz  not null default now()
);

-- ---------- 2. 打开行级安全 ----------
alter table public.event   enable row level security;
alter table public.team    enable row level security;
alter table public.gallery enable row level security;

-- ---------- 3. 表级授权(GRANT) ----------
-- anon           = 未登录的访客(网页只带 Publishable Key)
-- authenticated  = 在 admin.html 登录后的你
grant select                       on public.event to anon, authenticated;
grant insert, update, delete       on public.event to authenticated;

grant select, insert               on public.team  to anon, authenticated;
grant update, delete               on public.team  to authenticated;

-- 相册:人人可看往届照片;只有登录的你能上传/删除。
grant select                       on public.gallery to anon, authenticated;
grant insert, update, delete       on public.gallery to authenticated;

-- ---------- 4. 行级安全策略(RLS Policy) ----------
-- 目标:人人可看名单、人人可提交报名;只有登录的你能改赛事、能删改战队。
-- 先删同名策略再建,保证本脚本可反复运行不报错。

drop policy if exists event_read  on public.event;
drop policy if exists event_write on public.event;
create policy event_read  on public.event for select to anon, authenticated using (true);
create policy event_write on public.event for all    to authenticated using (true) with check (true);

drop policy if exists team_read   on public.team;
drop policy if exists team_insert on public.team;
drop policy if exists team_update on public.team;
drop policy if exists team_delete on public.team;
create policy team_read   on public.team for select to anon, authenticated using (true);
create policy team_insert on public.team for insert to anon, authenticated with check (true);
create policy team_update on public.team for update to authenticated using (true) with check (true);
create policy team_delete on public.team for delete to authenticated using (true);

-- 相册:人人可读;只有登录的你(authenticated)能写/删。
drop policy if exists gallery_read  on public.gallery;
drop policy if exists gallery_write on public.gallery;
create policy gallery_read  on public.gallery for select to anon, authenticated using (true);
create policy gallery_write on public.gallery for all    to authenticated using (true) with check (true);

-- 完成。回到网页刷新即可。
