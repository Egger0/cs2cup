with rounds as (
  select * from (values (0,'16强',8,3),(1,'八强',4,3),(2,'半决赛',2,3),(3,'总决赛',1,5)) as r(rnd,label,cnt,bo)
)
insert into public.match (tournament_id, round, slot, round_label, best_of, scheduled_at)
select t.id, r.rnd, s.slot, r.label, r.bo,
       timestamptz '2026-11-14 12:00+08' + (r.rnd * interval '7 day') + (s.slot * interval '100 min')
from public.tournament t, rounds r, lateral generate_series(0, r.cnt-1) as s(slot)
where t.slug = '2026-nlc'
on conflict (tournament_id, round, slot) do nothing;

update public.match m set source_match_a_id = a.id, source_match_b_id = b.id
from public.match a, public.match b
where m.round > 0
  and m.tournament_id = (select id from public.tournament where slug = '2026-nlc')
  and a.round = m.round - 1 and a.slot = m.slot * 2
  and b.round = m.round - 1 and b.slot = m.slot * 2 + 1
  and a.tournament_id = m.tournament_id and b.tournament_id = m.tournament_id;

update public.match m set team_a_id = ta.id from public.team ta
where m.round = 0 and ta.seed = m.slot + 1 and ta.tournament_id = m.tournament_id
  and m.tournament_id = (select id from public.tournament where slug = '2026-nlc');

update public.match m set team_b_id = tb.id from public.team tb
where m.round = 0 and tb.seed = 16 - m.slot and tb.tournament_id = m.tournament_id
  and m.tournament_id = (select id from public.tournament where slug = '2026-nlc');

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
