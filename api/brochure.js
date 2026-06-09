// Vercel serverless function — serves /brochures/:slug with the property
// name baked into <title> and Open Graph meta tags so WhatsApp / Slack /
// iMessage previews show "48 Upper Primrose" instead of "Property Brochure".
// Crawlers don't run JS, so the static brochure.html's title can't reach
// them via client-side document.title updates.

// Reuses the same VITE_-prefixed vars as the client bundle — Vercel exposes
// every dashboard env var to serverless functions via process.env regardless
// of prefix, and `vercel dev` loads them from .env locally. One source of truth.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Hostnames served as the neutral (agent-share) variant. Add the registered
// domain here when it's chosen — until then we only fall back to the
// ?brand=agent query param for local testing.
const AGENT_HOSTS = [];

function detectBrandMode(req) {
  // Query param wins so we can test the agent variant locally without
  // needing to own the neutral domain. 'agent-anon' is the in-portal
  // discovery preview — same un-branded layout as 'agent' but with
  // the property name replaced by its CTR code (slug) on every
  // surface that would otherwise leak it.
  const qp = req.query && (req.query.brand || '');
  if (qp === 'agent' || qp === 'direct' || qp === 'agent-anon') return qp;
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  for (const h of AGENT_HOSTS) {
    if (host === h || host.endsWith('.' + h)) return 'agent';
  }
  return 'direct';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  const slug = (req.query && req.query.slug) || '';
  const brandMode = detectBrandMode(req);
  let title = 'Property Brochure';
  let description = 'View this property brochure';
  let image = '';

  if (slug && SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const lookup = `${SUPABASE_URL}/rest/v1/partner_properties?slug=eq.${encodeURIComponent(slug)}&select=property_name,tagline,description,hero_image_url&limit=1`;
      const r = await fetch(lookup, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      });
      const data = await r.json();
      if (Array.isArray(data) && data[0]) {
        const p = data[0];
        if (brandMode === 'agent-anon') {
          // Anon mode: surface only the CTR code on every SEO/social
          // preview surface. Otherwise the property name leaks via
          // WhatsApp / Slack link previews and defeats the
          // anonymisation upstream.
          title = String(slug || '').toUpperCase();
          description = 'Property preview';
        } else {
          if (p.property_name) title = p.property_name;
          const subtitle = p.tagline || (p.description ? p.description.replace(/\s+/g, ' ').slice(0, 180) : '');
          if (subtitle) description = subtitle;
        }
        if (p.hero_image_url) {
          // Same im_w hint we use everywhere else for muscache URLs.
          const u = p.hero_image_url;
          if (u.indexOf('muscache.com') !== -1 && !/[?&]im_w=/.test(u)) {
            image = u + (u.indexOf('?') === -1 ? '?' : '&') + 'im_w=1200';
          } else {
            image = u;
          }
        }
      }
    } catch (err) {
      // Fall through with generic defaults — never break the page on lookup error.
      console.error('[api/brochure] property lookup failed:', err);
    }
  }

  // Fetch the static brochure.html from the same deployment and inject the
  // OG tags. We do this at request time rather than at build time so the
  // function stays decoupled from how Vite emits brochure.html.
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers.host;
  let html;
  try {
    const r = await fetch(`${proto}://${host}/brochure.html`);
    html = await r.text();
  } catch (err) {
    res.status(502).send('Failed to load brochure shell');
    return;
  }

  const ogBlock = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
  ].filter(Boolean).join('\n  ');

  // Replace the existing <title>…</title> in the shell with our OG block.
  // brochure.html only has a single static <title> at this position.
  html = html.replace(/<title>[\s\S]*?<\/title>/, ogBlock);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(html);
}
