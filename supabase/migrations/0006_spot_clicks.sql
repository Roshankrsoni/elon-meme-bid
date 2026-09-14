-- Sponsor My Body — per-spot click counters (placed brands only).
-- Run in the Supabase SQL editor. Clicks go through the SECURITY DEFINER
-- RPC below so anon clients can increment without direct write access.

create table if not exists public.spot_clicks (
  spot_id text primary key,
  clicks bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.spot_clicks enable row level security;

drop policy if exists "anon read clicks" on public.spot_clicks;
create policy "anon read clicks"
  on public.spot_clicks for select
  to anon
  using (true);

create or replace function public.record_spot_click(p_spot_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  insert into public.spot_clicks (spot_id, clicks)
  values (p_spot_id, 1)
  on conflict (spot_id)
  do update set clicks = spot_clicks.clicks + 1, updated_at = now()
  returning spot_clicks.clicks into n;
  return n;
end;
$$;

grant execute on function public.record_spot_click(text) to anon;
