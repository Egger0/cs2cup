do $$
declare
  pool text[] := array['沙2','荒漠迷城','炼狱小镇','核子危机','死亡游乐园','远古遗迹','阿努比斯'];
  m record;
  rotated text[];
  i integer;
  upset boolean;
  win_a boolean;
  s1a integer; s1b integer; s2a integer; s2b integer; s3a integer; s3b integer;
  played_third boolean;
begin
  for m in
    select id, slot, team_a_id, team_b_id, tournament_id
    from public.match
    where round = 0
      and tournament_id = (select id from public.tournament where slug = '2026-nlc')
    order by slot
  loop
    rotated := array[]::text[];
    for i in 0..6 loop
      rotated := rotated || pool[((m.slot + i) % 7) + 1];
    end loop;

    upset := m.slot in (2, 5);
    win_a := not upset;

    s1a := case when win_a then 13 else 9 end;
    s1b := case when win_a then 7 else 13 end;
    s2a := case when win_a then 10 else 13 end;
    s2b := case when win_a then 13 else 11 end;
    played_third := true;
    s3a := case when win_a then 16 else 12 end;
    s3b := case when win_a then 14 else 16 end;

    insert into public.match_map (match_id, pick_order, map_name, action, chosen_by, score_a, score_b, played)
    values
      (m.id, 1, rotated[1], 'ban',     'a', null, null, false),
      (m.id, 2, rotated[2], 'ban',     'b', null, null, false),
      (m.id, 3, rotated[3], 'pick',    'a', s1a,  s1b,  true),
      (m.id, 4, rotated[4], 'pick',    'b', s2a,  s2b,  true),
      (m.id, 5, rotated[5], 'ban',     'a', null, null, false),
      (m.id, 6, rotated[6], 'ban',     'b', null, null, false),
      (m.id, 7, rotated[7], 'decider', null, case when played_third then s3a end,
                                             case when played_third then s3b end, played_third)
    on conflict (match_id, pick_order) do nothing;

    update public.match
    set score_a = 2,
        score_b = 1,
        winner_team_id = case when win_a then m.team_a_id else m.team_b_id end
    where id = m.id;

    if not win_a then
      update public.match set score_a = 1, score_b = 2 where id = m.id;
    end if;
  end loop;
end
$$;

update public.tournament
set champion_team_id = null
where slug in ('2022-spring-nlc', '2022-autumn-nlc', '2025-nlc');

insert into public.club_member (name, role, handle, intro, sort_order)
values
  ('待补充', '社长', null, '负责赛事统筹与对外联络', 1),
  ('待补充', '赛事负责人', null, '负责赛程编排、裁判与赛果记录', 2),
  ('待补充', '技术负责人', null, '负责服务器、反作弊与直播推流', 3),
  ('待补充', '宣传负责人', null, '负责海报、现场摄影与社群运营', 4)
on conflict do nothing;

insert into public.post (slug, title, summary, body, pinned, published_at)
values
  ('2026-nlc-postponed', '第四届宁理杯延期通知',
   '受场地安排影响,第四届宁理杯开赛时间待定,报名通道保持开放。',
   '场地协调完成后会第一时间在本页与 QQ 群同步新的开赛时间。已提交的报名全部有效,无需重复提交。如果队伍成员有变动,联系赛事负责人更新即可。',
   true, timestamptz '2026-08-20 10:00+08'),
  ('server-128-tick', '校内比赛服已升级至 128-tick',
   '训练与正赛统一使用 128-tick 服务器,MR12 规则,平局进入加时。',
   '服务器位于校园网内,延迟稳定在 10ms 以内。开赛前会开放两个晚上的自由练习时段,群内会发连接方式。',
   false, timestamptz '2026-07-02 20:30+08'),
  ('recruit-2026', '电竞社纳新:不只打比赛',
   '除了选手,我们同样需要解说、导播、摄影与赛事运营。',
   '一场比赛跑起来需要的远不止十个人。如果你对解说、OB 导播、现场摄影、海报设计或者赛事编排感兴趣,都可以直接联系我们。',
   false, timestamptz '2026-09-01 09:00+08')
on conflict (slug) do nothing;
