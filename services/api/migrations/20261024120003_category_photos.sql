-- An optional photo per category (uploaded in the admin's Categories page,
-- same as product photos), shown on its tile on the storefront's home page.
-- Without one, the tile falls back to the category's newest product photo,
-- then to a drawing of the garment.
alter table public.categories add column image_path text;
