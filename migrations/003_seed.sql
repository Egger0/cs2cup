insert into public.site_setting (id, club_name, club_name_en, school, contact_qq, contact_wechat, footer_copy)
values (1, '宁波理工电竞社', 'ESPORTS CLUB', '浙大宁波理工学院', '661543515', '无', '© 2026 宁波理工电竞社')
on conflict (id) do nothing;

insert into public.tournament (slug, title, game, season, edition, status, team_cap, hero_eyebrow, hero_top, hero_bottom, lede)
values
  ('2022-spring-nlc', '第一届春季宁理杯', 'csgo', '2022 春季', 1, 'finished', 16, '', '', '宁理杯', ''),
  ('2022-autumn-nlc', '第二届秋季宁理杯', 'csgo', '2022 秋季', 2, 'finished', 16, '', '', '宁理杯', ''),
  ('2025-nlc',        '第三届宁理杯',     'csgo', '2025',      3, 'finished', 16, '', '', '宁理杯', '')
on conflict (slug) do nothing;

insert into public.tournament (
  slug, title, game, season, edition, status, team_cap,
  hero_eyebrow, hero_top, hero_bottom, lede, map_pool, rules, faqs
)
values (
  '2026-nlc',
  '第四届宁理杯',
  'csgo',
  '2026',
  4,
  'postponed',
  16,
  '宁理杯无限延期中..........',
  'CSGO',
  '宁理杯',
  '十六支战队,单败淘汰,现役地图组七图轮换。带上你的五人车,来抢下这座校园杯——报名通道现已开放。',
  '["沙2","荒漠迷城","炼狱小镇","核子危机","死亡游乐园","远古遗迹","阿努比斯"]'::jsonb,
  $rules$[
    {"label":"赛制","title":"单败淘汰","body":"16 队直接进入淘汰赛,每轮 BO3,总决赛 BO5。输一场即出局,赢到最后夺冠。"},
    {"label":"地图","title":"现役地图组","body":"沙2、荒漠迷城、炼狱小镇、核子危机、死亡游乐园、远古遗迹、阿努比斯,共 7 张。赛前 Ban/Pick 定图。"},
    {"label":"资格","title":"在校学生","body":"凭学生证参赛,每人限报一支战队。首发 5 人,可带 1 名替补,替补需赛前登记。"},
    {"label":"公平","title":"反作弊","body":"全程开启官方反作弊,禁用第三方脚本与外设宏。一经发现取消资格,战绩清零。"},
    {"label":"对局","title":"服务器","body":"校园局域网 128-tick 服务器,MR12 规则,平局进入加时。掉线 5 分钟内可暂停等待。"},
    {"label":"奖励","title":"冠军荣誉","body":"冠亚季军颁发奖杯与外设奖品,全体参赛计入社团积分,MVP 单独表彰。"}
  ]$rules$::jsonb,
  $faqs$[
    {"question":"报名截止到什么时候?","answer":"名额满即截止,先到先得。上方「剩余席位」实时显示还剩多少空位。"},
    {"question":"凑不齐五个人可以报名吗?","answer":"可以先报名占位,首发 5 人昵称在开赛前补齐即可。缺人也能在社群里找队友组队。"},
    {"question":"提交后信息能修改吗?","answer":"如需改动请联系赛事负责人,我们会在编排前更新。"},
    {"question":"对阵表什么时候公布?","answer":"报名满员后统一抽签,种子对阵会即时反映在本页「对阵赛程」中。"},
    {"question":"比赛在哪里进行?","answer":"线下电竞教室集中开赛,具体场地与时间通过报名时填写的联系方式通知。"}
  ]$faqs$::jsonb
)
on conflict (slug) do nothing;
