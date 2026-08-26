insert into public.club_member (name, role, handle, intro, sort_order)
values
  ('待补充', '社长', null, '负责赛事统筹与对外联络', 1),
  ('待补充', '赛事负责人', null, '负责赛程编排、裁判与赛果记录', 2),
  ('待补充', '技术负责人', null, '负责服务器、反作弊与直播推流', 3),
  ('待补充', '宣传负责人', null, '负责海报、现场摄影与社群运营', 4)
on conflict (role) do nothing;

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
