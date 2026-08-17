-- "Sold on the customer's account" as a tender type, alongside cash/mobile
-- money/card -- lets a single POS sale split across e.g. part cash, part
-- credit, the same way it already splits across payment methods.
-- ALTER TYPE ... ADD VALUE can't be used in the same transaction as a
-- statement that references the new value, so this is its own migration
-- file, ahead of the trigger (next migration) that reads 'credit'.
alter type public.payment_method add value 'credit';
