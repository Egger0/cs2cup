insert into public.site_setting (id, club_name, club_name_en, school, contact_qq, contact_wechat, footer_copy)
values (1, '宁波理工电竞社', 'ESPORTS CLUB', '浙大宁波理工学院', '661543515', '无', '© 2026 宁波理工电竞社')
on conflict (id) do nothing;

insert into public.game (slug, name, name_en, accent_color, tagline, description, format_note, sort_order, active)
values
  ('cs2', 'CS2', 'Counter-Strike 2', '#e3a63a',
   '社团的主战场,宁理杯已经办到第四届。',
   '五人一队,进攻方安放 C4,防守方拆弹或打完时间。宁理杯用现役七图池,赛前 Ban/Pick 定图,MR12 规则先到 13 回合胜出,平局进加时。',
   '单败淘汰 · 前几轮 BO3 · 决赛 BO5 · 校内 128-tick 服务器',
   1, true),
  ('lol', '英雄联盟', 'League of Legends', '#c89b3c',
   '五人开黑,校内赛与观赛活动。',
   '上单、打野、中单、射手、辅助五个位置,推塔到对方基地。社团组织校内排位赛和 S 赛观赛,新人也能找到队友。',
   '待定 · 想牵头办一场校内赛可以直接联系我们',
   2, true),
  ('valorant', '无畏契约', 'VALORANT', '#ff4655',
   '战术射击加英雄技能,社团新开的项目。',
   '五人一队,进攻方安放 Spike,防守方拆除。每名选手选一位有独特技能的特工,枪法之外还要配合技能开局。',
   '待定 · 正在招募第一批固定队员',
   3, true)
on conflict (slug) do update set
  description = excluded.description,
  format_note = excluded.format_note;

insert into public.tournament (slug, title, game_id, season, edition, status, team_cap, hero_eyebrow, hero_top, hero_bottom, lede)
select v.slug, v.title, g.id, v.season, v.edition, v.status, 16, '', '', '宁理杯', ''
from (values
  ('2022-spring-nlc', '第一届春季宁理杯', '2022 春季', 1, 'finished'),
  ('2022-autumn-nlc', '第二届秋季宁理杯', '2022 秋季', 2, 'finished'),
  ('2025-nlc',        '第三届宁理杯',     '2025',      3, 'finished')
) as v(slug, title, season, edition, status)
cross join public.game g
where g.slug = 'cs2'
on conflict (slug) do nothing;

insert into public.tournament (
  slug, title, game_id, season, edition, status, team_cap,
  hero_eyebrow, hero_top, hero_bottom, lede, map_pool, rules, faqs
)
select
  '2026-nlc',
  '第四届宁理杯',
  g.id,
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
from public.game g
where g.slug = 'cs2'
on conflict (slug) do nothing;
