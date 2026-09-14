-- Sponsor My Body — catalogue seed data (brands + ticker countries).
-- Run after 0002_leaderboard.sql in the Supabase SQL editor.
-- The page ships with the same rows baked in as a fallback and swaps to
-- these once the backend is configured, so editing here edits the live site.

create table if not exists public.brands (
  id text primary key,
  label text not null,
  mark text not null default 'glyph' check (mark in ('glyph', 'code')),
  fill text not null default '#dce84f',
  seed integer not null default 1,
  band text[] not null default '{}',
  handle text not null default '',
  blurb text not null default '',
  url text not null default '',
  amount_cents integer not null default 100000 check (amount_cents > 0),
  views integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.brands enable row level security;

drop policy if exists "anon read brands" on public.brands;
create policy "anon read brands"
  on public.brands for select
  to anon
  using (true);

insert into public.brands (id, label, mark, fill, seed, band, handle, blurb, url, amount_cents, views)
values
  ('volt', 'Volt', 'glyph', '#dce84f', 23, array['VOLT V3', 'VOLT'], '@volt', 'Every AI video and image model', 'volt.run', 800000, 32269)
on conflict (id) do nothing;

create table if not exists public.ticker_countries (
  position integer primary key,
  flag text not null,
  name text not null
);

alter table public.ticker_countries enable row level security;

drop policy if exists "anon read ticker" on public.ticker_countries;
create policy "anon read ticker"
  on public.ticker_countries for select
  to anon
  using (true);

insert into public.ticker_countries (position, flag, name)
values
  (1, '🇵🇸', 'Palestine'),
  (2, '🇹🇭', 'Thailand'),
  (3, '🇺🇬', 'Uganda'),
  (4, '🇧🇷', 'Brazil'),
  (5, '🇰🇪', 'Kenya'),
  (6, '🇯🇵', 'Japan'),
  (7, '🇳🇱', 'Netherlands'),
  (8, '🇿🇦', 'South Africa')
on conflict (position) do nothing;
