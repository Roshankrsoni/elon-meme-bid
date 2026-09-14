-- Sponsor My Body — minimum bid, enforced at the row level.
-- Run in the Supabase SQL editor. This is the global backstop ($10, the
-- lowest per-spot floor); the client and the create-checkout edge function
-- enforce each spot's own floor (see minBid in brandSlotDefs).

alter table public.bids drop constraint if exists bids_amount_cents_check;
alter table public.bids
  add constraint bids_min_amount check (amount_cents >= 1000);
