import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, fail } from '@/lib/api';
import { supabaseServer } from '@/lib/supabase';
import { makeCutout, toDataUrl } from '@/lib/cutout';

export const runtime = 'nodejs'; // sharp
export const maxDuration = 60;

const BUCKET = 'scans';

/** Supabase is optional: without it the cutout comes back inline. */
function db(): SupabaseClient | null {
  try {
    return supabaseServer();
  } catch {
    return null;
  }
}

/**
 * Lift one object off its background.
 *
 * Called once per object from the browser, several at a time, after the scan has
 * already drawn the outlines. Takes the lot's existing `image_url`, whether that
 * is a Supabase URL or an inline data URL, or a `crop` file in a multipart body.
 */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const crop = await readCrop(req);
    if (!crop) return fail('an imageUrl or a crop file is required');

    const cutout = await makeCutout(crop);
    if (!cutout) return fail('cutout unavailable', 502);

    const client = db();
    if (client) {
      const path = `cutouts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error } = await client.storage.from(BUCKET).upload(path, cutout, {
        contentType: 'image/png',
        upsert: true,
      });
      if (!error) {
        const imageUrl = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        console.log(`cutout: uploaded in ${Date.now() - started}ms`);
        return ok({ imageUrl });
      }
      console.warn('cutout upload failed, inlining instead:', error.message);
    }

    const imageUrl = await toDataUrl(cutout);
    console.log(`cutout: inlined ${imageUrl.length}b in ${Date.now() - started}ms`);
    return ok({ imageUrl });
  } catch (e) {
    console.error('cutout route failed', e);
    return fail(e instanceof Error ? e.message : 'cutout failed', 500);
  }
}

/** Accept a multipart crop, an http(s) URL, or a data: URL. */
async function readCrop(req: NextRequest): Promise<Buffer | null> {
  const type = req.headers.get('content-type') ?? '';

  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('crop');
    if (file instanceof File && file.size > 0) return Buffer.from(await file.arrayBuffer());
    const url = form.get('imageUrl');
    return typeof url === 'string' ? fromUrl(url) : null;
  }

  const body = (await req.json().catch(() => null)) as { imageUrl?: string } | null;
  return body?.imageUrl ? fromUrl(body.imageUrl) : null;
}

async function fromUrl(url: string): Promise<Buffer | null> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    return Buffer.from(url.slice(comma + 1), 'base64');
  }
  if (!url.startsWith('http')) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}
