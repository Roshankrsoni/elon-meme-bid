-- Sponsor My Body — live leaderboard (top paid bid per spot).
-- Run after 0001_bids.sql in the Supabase SQL editor.

create or replace view public.leaderboard as
select distinct on (spot_id)
  spot_id,
  spot_label,
  brand_name,
  amount_cents,
  paid_at
from public.bids
where status = 'paid'
order by spot_id, amount_cents desc;

grant select on public.leaderboard to anon;
