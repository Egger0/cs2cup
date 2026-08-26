insert into public.team (tournament_id, name, tag, captain, contact, dept, status, seed)
select t.id, v.name, v.tag, v.captain, v.contact, v.dept, 'approved', v.seed
from public.tournament t,
(values
  ('临界爆破小队','FROST','阿铭','qq:100001','计算机与数据工程学院',1),
  ('午夜狙击手','MDNT','老陈','qq:100002','机械工程学院',2),
  ('沙二守望者','D2WT','小柯','qq:100003','传媒与设计学院',3),
  ('赤潮电子竞技','RTID','阿海','qq:100004','设计学院',4),
  ('回声战术','ECHO','小林','qq:100005','信息科学与工程学院',5),
  ('钢铁防线','IRON','大鹏','qq:100006','土木建筑学院',6),
  ('夜航西飞','NFLY','子墨','qq:100007','外国语学院',7),
  ('像素猎人','PXHT','阿宽','qq:100008','计算机与数据工程学院',8),
  ('甬江突击','YJST','小江','qq:100009','商学院',9),
  ('零点战队','ZERO','阿泽','qq:100010','法律与传媒学院',10),
  ('白鲨小队','SHRK','大白','qq:100011','生物与化学工程学院',11),
  ('暴风前哨','STRM','风哥','qq:100012','机械工程学院',12),
  ('静默突破','SLNT','小静','qq:100013','设计学院',13),
  ('北纬三十','N30','阿北','qq:100014','商学院',14),
  ('灰烬重燃','ASHE','小灰','qq:100015','信息科学与工程学院',15),
  ('末班车','LSTB','老王','qq:100016','计算机与数据工程学院',16)
) as v(name,tag,captain,contact,dept,seed)
where t.slug = '2026-nlc'
on conflict (tournament_id, tag) do nothing;

insert into public.player (team_id, nickname, role, is_substitute, sort_order)
select t.id, t.tag || '_' || v.suffix, v.role, v.sub, v.ord
from public.team t,
(values
  ('leader','指挥',false,1),
  ('awp','狙击手',false,2),
  ('entry','突破手',false,3),
  ('support','辅助',false,4),
  ('lurk','游走',false,5),
  ('sub','替补',true,6)
) as v(suffix, role, sub, ord)
where t.tournament_id = (select id from public.tournament where slug = '2026-nlc')
on conflict do nothing;
