import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { structured, imagePart } from '@/lib/llm';
import type OpenAI from 'openai';
import { searchComps } from '@/lib/tavily';
import { createProduct, shopifyConfigured } from '@/lib/shopify';
import type { Item, ListingResponse } from '@/lib/types';

export const maxDuration = 60;

type Listing = {
  title: string;
  brand: string;
  category: string;
  size: string;
  colour: string;
  condition: string;
  material: string;
  description: string;
  keywords: string[];
};

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return fail('multipart form expected');
  const showId = String(form.get('showId') ?? '');
  const photos = form.getAll('photos').filter((p): p is File => p instanceof File && p.size > 0);
  if (!showId || photos.length === 0) return fail('showId and at least one photo are required');
  if (!process.env.OPENAI_API_KEY) return fail('OPENAI_API_KEY not set', 500);

  const db = supabaseServer();

  // 1. Upload photos
  const imageUrls: string[] = [];
  const imageBlocks: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const photo of photos.slice(0, 4)) {
    const buf = Buffer.from(await photo.arrayBuffer());
    const ext = (photo.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${showId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage.from('photos').upload(path, buf, { contentType: photo.type || 'image/jpeg' });
    if (error) return fail(`upload failed: ${error.message}`, 500);
    imageUrls.push(db.storage.from('photos').getPublicUrl(path).data.publicUrl);
    const mediaType = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(photo.type) ? photo.type : 'image/jpeg') as
      | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
    imageBlocks.push(imagePart(buf.toString('base64'), mediaType));
  }

  // 2. Vision listing
  const listing = await structured<Listing>({
    system: 'You are an expert second-hand fashion reseller writing Depop/Vinted listings. Be specific and honest. Guess brand and size from labels if visible, otherwise your best estimate marked with "approx". Condition is "N/5 - short note".',
    content: [...imageBlocks, { type: 'text', text: 'Create a listing for this item.' }],
    name: 'listing',
    maxTokens: 800,
    schema: {
      properties: {
        title: { type: 'string' }, brand: { type: 'string' }, category: { type: 'string' }, size: { type: 'string' },
        colour: { type: 'string' }, condition: { type: 'string' }, material: { type: 'string' },
        description: { type: 'string', description: '1-2 sentences, fit and wear notes' },
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'brand', 'category', 'size', 'colour', 'condition', 'material', 'description', 'keywords'],
    },
  });

  // 3. Price comps
  const comps = await searchComps(`${listing.brand} ${listing.title} ${listing.size} second hand price`);
  let priceEstimate = 25;
  try {
    const priced = await structured<{ price_estimate: number; rationale: string }>({
      system: 'You price second-hand clothing for the UK market in GBP. Use the comps if present, otherwise your knowledge of resale prices. Return a realistic quick-sale price.',
      content: `Listing: ${JSON.stringify(listing)}\nComps: ${JSON.stringify(comps)}`,
      name: 'price',
      maxTokens: 300,
      schema: {
        properties: { price_estimate: { type: 'number' }, rationale: { type: 'string' } },
        required: ['price_estimate', 'rationale'],
      },
    });
    priceEstimate = Math.max(1, Math.round(priced.price_estimate));
  } catch (e) {
    console.warn('pricing failed, using default', e);
  }
  const buyNow = Math.round(priceEstimate * 1.1);

  // 4. Shopify product
  let shopify: { productId: string; variantId: string } | null = null;
  if (shopifyConfigured()) {
    try {
      shopify = await createProduct({
        title: listing.title,
        descriptionHtml: `<p>${listing.description}</p><p>Brand: ${listing.brand}. Size: ${listing.size}. Condition: ${listing.condition}. Material: ${listing.material}.</p>`,
        vendor: listing.brand,
        price: buyNow,
        imageUrl: imageUrls[0],
      });
    } catch (e) {
      console.warn('shopify product failed', e);
    }
  } else {
    console.warn('Shopify env not set, skipping product creation');
  }

  // 5. Insert item
  const { data: last } = await db.from('items').select('sort_order').eq('show_id', showId).order('sort_order', { ascending: false }).limit(1);
  const sortOrder = ((last?.[0] as { sort_order: number } | undefined)?.sort_order ?? 0) + 1;
  const { data: item, error } = await db
    .from('items')
    .insert({
      show_id: showId,
      title: listing.title,
      brand: listing.brand,
      size: listing.size,
      condition: listing.condition,
      description: listing.description,
      price_estimate: priceEstimate,
      buy_now_price: buyNow,
      shopify_product_id: shopify?.productId ?? null,
      shopify_variant_id: shopify?.variantId ?? null,
      image_urls: imageUrls,
      status: 'listed',
      sort_order: sortOrder,
    })
    .select('*')
    .single<Item>();
  if (error || !item) return fail(error?.message ?? 'insert failed', 500);
  return ok<ListingResponse>({ item });
}
