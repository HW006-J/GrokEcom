-- Demo show + 3 items. Fixed show id so the UI can hard-code it.
insert into shows (id, title, phase) values
  ('00000000-0000-0000-0000-000000000001', 'Luka''s Wardrobe Clear-out', 'idle')
on conflict (id) do nothing;

insert into items (id, show_id, title, brand, size, condition, description, price_estimate, buy_now_price, image_urls, sort_order) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
   'Carhartt WIP Detroit Jacket', 'Carhartt WIP', 'M', '4/5 - light fade, no damage',
   'Classic Detroit jacket in hamilton brown duck canvas, blanket lined. Runs slightly large.',
   85, 95, array['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800'], 1),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001',
   'Nike Vintage Windbreaker', 'Nike', 'L', '3/5 - small mark on left sleeve',
   '90s colour-block windbreaker, half zip, packable hood. Boxy 90s fit.',
   40, 45, array['https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800'], 2),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001',
   'Levi''s 501 Original Jeans', 'Levi''s', 'W32 L32', '5/5 - worn twice',
   'Straight fit, mid-stone wash, button fly. True to size.',
   35, 40, array['https://images.unsplash.com/photo-1542272604-787c3835535d?w=800'], 3)
on conflict (id) do nothing;
