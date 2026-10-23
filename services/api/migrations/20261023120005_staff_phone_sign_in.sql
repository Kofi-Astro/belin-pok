-- Staff can be invited by phone (sent by SMS or WhatsApp) as well as by
-- email, and someone without an email address signs in with their phone
-- number. Phone numbers are stored normalised to Ghana's local format
-- (0XXXXXXXXX; see app/phone.py), so "+233 24 123 4567", "0241234567"
-- and "024-123-4567" are all the same account at sign-in.
alter table public.users add column phone text unique;

-- Every login needs at least one way to sign in.
alter table public.users drop constraint users_check;
alter table public.users
  add constraint users_has_sign_in check (username is not null or email is not null or phone is not null);

-- The staff row keeps contact details for the Staff page, as it does email.
alter table public.staff add column phone text;
