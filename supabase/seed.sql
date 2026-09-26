-- One demo sale with five lots, matching lib/mock.ts so the UI has real rows to read.
insert into sales (id, code, title, phase) values
  ('00000000-0000-0000-0000-0000000000a1', 'DEMO', 'Luka''s front room', 'idle')
on conflict (id) do nothing;

insert into lots (id, sale_id, name, category, condition, blurb, image_url, low, high, reserve, picked, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','Ceramic table lamp','Lighting','Very good','Fluted ceramic base with a pleated linen shade. Warm, soft light.','https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=700&q=80',65,90,45,true,1),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1','35mm rangefinder camera','Tech','Good, light brassing','Fully mechanical rangefinder with a fast 40mm lens. Shutter accurate.','https://images.unsplash.com/photo-1495121605193-b116b5b9c5fe?w=700&q=80',120,180,84,true,2),
  ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a1','Mid-century lounge chair','Furniture','Very good','Solid walnut frame, olive wool cushions. No wobble, no marks.','https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=700&q=80',180,260,126,true,3),
  ('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000a1','Waxed field jacket','Clothing','Good','Olive waxed cotton, corduroy collar, size M. Ready to re-wax.','https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&q=80',55,85,38,true,4),
  ('00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-0000000000a1','Suede running trainers','Footwear','Worn twice','UK 9, grey suede and mesh. Boxed with spare laces.','https://images.unsplash.com/photo-1539185441755-769473a23570?w=700&q=80',45,70,31,false,5)
on conflict (id) do nothing;
