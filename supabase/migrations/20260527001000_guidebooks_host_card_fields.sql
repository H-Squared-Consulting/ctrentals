-- Guidebook PR #3 — host card schema additions (GUIDEBOOK_DESIGN_GUIDE §4.1).
--
-- The Home page host card needs a one-paragraph welcome (Playfair italic)
-- and a round host photo. Neither lived in the PR #1 column list; adding
-- here so the host card has real fields to render and edit.
--
-- welcome_html stores rich text (paragraphs, emphasis, links). Rendered
-- through DOMPurify in PR #10.

alter table guidebooks
  add column if not exists welcome_html  text,
  add column if not exists host_photo_url text;

-- Seed Montrose so the Home card has something real on first view.
update guidebooks
  set welcome_html = $$<p>Welcome to <em>9 Montrose Terrace</em> — we're so glad you're here.</p>
<p>The house, the garden and the pool are all yours. Make yourself at home, raid the pantry, swim before breakfast.
If anything's not quite right — or you just want to say hi — message me on WhatsApp. I'm five minutes away.</p>
<p>Nicki will be in touch the day before you leave to set up departure.</p>$$,
      updated_at = now()
  where slug = 'montrose-terrace';
