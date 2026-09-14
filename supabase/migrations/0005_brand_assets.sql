-- Sponsor My Body — brand logo + contact on the catalogue.
-- Run in the Supabase SQL editor. `logo_url` points at a file in `public/`
-- (served as-is) or any https URL; the client prints it onto the sticker.

alter table public.brands add column if not exists logo_url text not null default '';
alter table public.brands add column if not exists contact_email text not null default '';

insert into public.brands (id, label, mark, fill, seed, band, handle, blurb, url, amount_cents, views, logo_url, contact_email)
values
  ('x', 'X', 'glyph', '#000000', 5, array['X', 'X'], '@X', 'Official updates from X', 'x.com', 800000, 0, '/brand-x.png', 'admin@onbid.lol')
on conflict (id) do nothing;
