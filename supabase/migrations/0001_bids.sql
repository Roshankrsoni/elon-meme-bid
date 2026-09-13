-- Sponsor My Body — bidding backend.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- Every bid is tied to one body spot. A spot is only claimed once its bid is
-- marked `paid` by the Dodo webhook; the client enforces "top paid bid wins".
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  spot_id text not null,
  spot_label text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  brand_name text not null,
  email text not null,
  product_url text not null,
  brand_image_url text not null default '',
  suggested_size_cm numeric not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled')),
  dodo_session_id text,
  dodo_product_id text,
  dodo_payment_id text,
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bids_spot_status_idx
  on public.bids (spot_id, status, amount_cents desc);

alter table public.bids enable row level security;

-- Bids are a public auction: anyone may read, anyone may place one.
-- Only the service role (edge functions) can update rows.
drop policy if exists "anon read bids" on public.bids;
create policy "anon read bids"
  on public.bids for select
  to anon
  using (true);

drop policy if exists "anon insert bids" on public.bids;
create policy "anon insert bids"
  on public.bids for insert
  to anon
  with check (true);

-- Brand logos uploaded at bid time. Public read, anon upload.
insert into storage.buckets (id, name, public)
values ('brand-logos', 'brand-logos', true)
on conflict (id) do nothing;

drop policy if exists "public read logos" on storage.objects;
create policy "public read logos"
  on storage.objects for select
  to anon
  using (bucket_id = 'brand-logos');

drop policy if exists "anon upload logos" on storage.objects;
create policy "anon upload logos"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'brand-logos');
