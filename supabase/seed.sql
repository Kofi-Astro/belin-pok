-- Run automatically by `supabase db reset` after all migrations.
-- Seeds the baseline category list from the product brief.
insert into public.categories (name, slug, description, display_order) values
  ('Caps',        'caps',        'Caps and headwear',        1),
  ('T-Shirts',    't-shirts',    'T-shirts and tees',        2),
  ('Jackets',     'jackets',     'Jackets and outerwear',    3),
  ('Sweatshirts', 'sweatshirts', 'Sweatshirts and hoodies',  4),
  ('Shorts',      'shorts',      'Shorts',                   5),
  ('Joggers',     'joggers',     'Joggers and sweatpants',   6),
  ('Boxers',      'boxers',      'Boxers and underwear',     7),
  ('Socks',       'socks',       'Socks',                    8)
on conflict (slug) do nothing;
