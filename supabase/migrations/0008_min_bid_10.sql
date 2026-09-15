-- Sponsor My Body — $10 floor for every spot, going forward.
-- Run in the Supabase SQL editor. Per-spot floors live in the client
-- (minBid in brandSlotDefs) and the create-checkout edge function.
--
-- NOT VALID grandfathers the existing sub-$10 UpperArm_Left rows
-- (3x $1 + 1x $40) so history is kept; all new/updated rows must be >= $10.

alter table public.bids drop constraint if exists bids_min_amount;
alter table public.bids
  add constraint bids_min_amount check (amount_cents >= 1000) not valid;
