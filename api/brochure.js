// Vercel serverless function — serves /brochures/:slug with the property
// name baked into <title> and Open Graph meta tags so WhatsApp / Slack /
// iMessage previews show "48 Upper Primrose" instead of "Property Brochure".
// Crawlers don't run JS, so the static brochure.html's title can't reach
// them via client-side document.title updates.

const SUPABASE_URL = 'https://mnvxitexcdgohzgtvwzg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udnhpdGV4Y2Rnb2h6Z3R2d3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTM4NTMsImV4cCI6MjA4OTQ4OTg1M30.h2Y1nIxV1xkvCyeSOknAiu-SrjPwijsueaJel10JoA4';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  const slug = (req.query && req.query.slug) || '';
  let title = 'Property Brochure';
  let description = 'View this property brochure';
  let image = '';

  if (slug) {
    try {
      const lookup = `${SUPABASE_URL}/rest/v1/partner_properties?slug=eq.${encodeURIComponent(slug)}&select=property_name,tagline,description,hero_image_url&limit=1`;
      const r = await fetch(lookup, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      });
      const data = await r.json();
      if (Array.isArray(data) && data[0]) {
        const p = data[0];
        if (p.property_name) title = p.property_name;
        const subtitle = p.tagline || (p.description ? p.description.replace(/\s+/g, ' ').slice(0, 180) : '');
        if (subtitle) description = subtitle;
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
