// supabase/functions/fetch-airbnb-title/index.ts
//
// Fetches an Airbnb listing URL server-side and returns the page's
// og:title meta tag — that's the human listing headline ("Spacious 4
// Bed Retreat with Stunning Views") that Airbnb renders in the page
// header, distinct from the internal property name we keep in the DB.
//
// Called from PropertyEditModal whenever the Airbnb URL is saved, so
// every property's airbnb_title column stays in sync without anyone
// pasting it by hand. The "Copy Airbnb links" modal in the admin
// global search uses the cached title in front of each URL when it
// builds the paste-ready block.
//
// Why server-side: the browser can't fetch airbnb.com directly (CORS).
// Deno runs in Supabase's network so it gets the page unobstructed.
//
// Failure modes:
//   - non-Airbnb URL passed in → 400
//   - fetch errors / 4xx / 5xx → 200 { ok: false, reason } so the
//     caller treats it as "no title" without bubbling a fatal error
//     into the property save flow
//   - markup changes → og:title regex falls through to <title>

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Validate the URL is Airbnb's. Stops the function from being abused
 *  to scrape arbitrary URLs while still tolerating the few Airbnb
 *  ccTLDs (.com, .co.za) the team actually pastes. */
function isAirbnbUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return /(^|\.)airbnb\.[a-z.]+$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Strip wrapping whitespace, HTML entities and a trailing "· Airbnb"
 *  suffix that Airbnb sometimes appends to `<title>`. og:title is
 *  cleaner so this only really matters for the fallback path. */
function tidy(title: string): string {
  return title
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s*[·-]\s*Airbnb\s*$/i, '')
    .trim();
}

function extractTitle(html: string): string | null {
  // og:title first — that's what Airbnb hand-renders for the listing
  // headline. Property attribute can be in either order so the regex
  // is intentionally loose on attribute position.
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  );
  if (og && og[1]) return tidy(og[1]);
  // Fallback to <title>.
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t && t[1]) return tidy(t[1]);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, reason: 'method-not-allowed' });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: 'invalid-json' });
  }

  const url: string | undefined = typeof body?.url === 'string' ? body.url.trim() : undefined;
  const propertyId: string | undefined = typeof body?.propertyId === 'string' ? body.propertyId : undefined;
  if (!url) return json(400, { ok: false, reason: 'missing-url' });
  if (!isAirbnbUrl(url)) return json(400, { ok: false, reason: 'not-an-airbnb-url' });

  let title: string | null = null;
  try {
    const res = await fetch(url, {
      // Pretending to be a normal browser improves Airbnb's response
      // (otherwise it can serve a heavily-trimmed bot version).
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-ZA,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return json(200, { ok: false, reason: `fetch-${res.status}` });
    }
    const html = await res.text();
    title = extractTitle(html);
  } catch (err) {
    console.warn('fetch failed:', err);
    return json(200, { ok: false, reason: 'fetch-error' });
  }

  if (!title) {
    return json(200, { ok: false, reason: 'title-not-found' });
  }

  // Best-effort cache write when the caller passed propertyId — saves
  // the front-end one round-trip on PropertyEditModal save. Failures
  // are non-fatal; the title is still returned in the response so the
  // client can stash it itself.
  if (propertyId) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await admin
        .from('partner_properties')
        .update({ airbnb_title: title })
        .eq('id', propertyId);
    } catch (err) {
      console.warn('cache write failed (non-fatal):', err);
    }
  }

  return json(200, { ok: true, title });
});
