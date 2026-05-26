# Guest Guidebook — Design & Implementation Guide

**Status:** Prescriptive build guide for the next Claude Code session.
**Codebase:** `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal`
**Branch context:** `feat/global-search-function` (and successor branches)
**Last revised:** 2026-05-26

This is the single source of truth for the Guest Guidebook feature. It synthesises:

1. The full visual design language audit of the admin portal (`src/app.css`, 4,982 lines).
2. A competitive teardown of Hostfully's guidebook product (the SaaS we are replacing for "9 Montrose Terrace" and other Southern Escapes properties).
3. The database schema and seed already committed on this branch (see §0.2).

Read this end-to-end before writing code. The decisions here are deliberate; do not re-derive them.

---

## Table of Contents

0. Preamble — codebase orientation, what already exists
1. Product overview
2. Information architecture
3. Visual design system (the canonical reference)
4. Component-by-component specification
5. Mobile-first responsive guidance
6. Accessibility checklist
7. Anti-patterns (lessons from Hostfully)
8. Implementation order
9. Out of scope (v1)
10. Open questions for the user

---

## 0. Preamble

### 0.1 What "guidebook" means here

Southern Escapes (SE) is a small Cape Town holiday-let business currently paying Hostfully ~USD/month per property for a hosted "guest guidebook" page. Hostfully's product is competent but flat, search-less, leaks credentials publicly, and buries emergencies four taps deep. We are going to replace it with a first-class in-house guidebook that is (a) better for guests, (b) entirely owned by SE, and (c) deeply integrated with the rest of the admin portal (properties, bookings, owners).

### 0.2 What already exists on this branch

These artefacts have been built and committed in this working tree — **honour them**:

- **`src/pages/GuidebookPage.tsx`** — public, magazine-styled, brochure-language guidebook at `/g/:slug`. Renders hero + sticky in-page nav (`Arrival`, `Your Stay`, `Explore`) with a centered 840px canvas and gold rules. Uses inline-SVG `<Icon>` system. Currently flat (no global search, no emergency CTA, no auth gating, no per-section privacy). This file is the scaffold — the next session extends it, not rewrites it.
- **`supabase/migrations/20260526200000_guidebooks_schema.sql`** — tables `guidebooks`, `guidebook_house_manuals`, `guidebook_manual_assignments`, `guidebook_recommendations`, `guidebook_recommendation_assignments`. RLS gates anon reads on `is_published`. Authenticated users full CRUD.
- **`supabase/migrations/20260526200500_guidebooks_seed_montrose.sql`** — a real, published guidebook for **9 Montrose Terrace** at slug `montrose-terrace`, with 9 manual entries (mix of `standard-*` and `mt-*`) and 20 curated Cape Town recommendations.
- **`supabase/migrations/20260526201000_guidebooks_grants.sql`** — PostgREST table-level GRANTs, required because RLS without grants returns 403 on Supabase.

The schema direction is **shared library + per-guidebook assignment with optional `override_body_html`** (Hostfully-style). Do not propose a different model.

### 0.3 The two surfaces

| Surface | Audience | Device target | Route | Auth |
| --- | --- | --- | --- | --- |
| **Guest guidebook** | Booked or prospective guest | Mobile-first (phone in landed-at-airport hand) | `/g/:slug` (and `/g/:slug/...` sub-paths) | Anonymous read of `is_published=true`; private fields gated by reservation code or magic link |
| **Admin guidebook editor** | SE host (Hayley, Nicki) + the team | Desktop-first | `/guidebooks`, `/guidebooks/:id` inside the admin portal sidebar | Existing Supabase auth (authenticated role) |

These two surfaces share the same database tables but render with very different visual languages:

- The guest surface uses the existing **brochure language** (cream + linen, Pacifico+Montserrat wordmark, gold rules, generous serif typography from `GuidebookPage.tsx`). It is *not* a clone of the admin chrome.
- The admin editor uses the existing **admin language** (white surfaces, Inter, blue `#0F4C75`, the `.detail-modal` / `.form-*` patterns documented in §3).

### 0.4 What this guide will NOT decide for you

Where the source reports were silent or in tension, I made calls I think are right; flag these to the user before shipping (see §10).

---

## 1. Product Overview

### 1.1 Mission statement

Replace Hostfully with a guidebook that lands a stressed-out guest on a phone, at 11pm, in the back of an Uber from Cape Town International, on **WiFi password, host phone number, and address-to-paste** in fewer than five seconds — and lets a panicked guest reach a real human or shut off the gas main in one tap. Everything else is gravy.

### 1.2 Target users

- **Primary: the guest, on a phone, in a hurry.** Optimise for thumb-reach, slow networks, sun-on-screen, and the I'm-stressed-and-need-the-answer-now mindset. Every design decision should ask: "would my mum find this in 3 seconds?"
- **Secondary: the host (Hayley, Nicki) on desktop.** Editing is a side activity done weekly, not a workflow. Their pain is keeping content fresh and not having to copy-paste between properties — hence the shared-library schema.

### 1.3 Two surfaces, summarised

```
┌─────────────────────────────────────────────────────────────┐
│ GUEST GUIDEBOOK (public)                                    │
│ /g/:slug                                                    │
│ Mobile-first · cream/linen · brochure wordmark              │
│ Anonymous read · is_published gate · per-field privacy tier │
│                                                             │
│   Home  Arrival  Stay  Explore  Departure  Emergency        │
│   ↑ persistent host-contact chip + emergency FAB            │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ shared Supabase tables
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ ADMIN GUIDEBOOK EDITOR (inside admin-portal)                │
│ /guidebooks · /guidebooks/:id                               │
│ Desktop-first · admin chrome · sidebar nav                  │
│ Authenticated only                                          │
│                                                             │
│   List of guidebooks · per-guidebook editor with sections   │
│   Shared library of manuals + recommendations               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Information Architecture

### 2.1 Required top-level sections (guest surface)

Six sections, in this order. **No reordering, no renaming.** These match guest mental models from the Hostfully teardown and from observation of how guests actually use guidebooks.

| # | Section | Purpose | Lives at |
| --- | --- | --- | --- |
| 1 | **Home** | "I just opened the link, what is this place?" Welcome, hero, host card, quick-actions strip (WiFi, check-out, host call, emergency, address) — the 5 most-needed answers above the fold. | `/g/:slug` (default) |
| 2 | **Arrival** | Check-in time, instructions, directions (embedded map + Open-in-Maps CTA, NOT a wall of prose), parking, WiFi card with one-tap copy. | `#arrival` |
| 3 | **House Manual** | Grouped (by category) expandable cards. Photos first wherever possible. | `#stay` (the current `GuidebookPage.tsx` calls this "Your Stay" — keep that label, IA-wise it's the House Manual) |
| 4 | **Departure** | Actual checkable checklist with progress bar, plus check-out time and instructions. | `#departure` |
| 5 | **Recommendations** | List + map dual view, grouped by category, tap-to-navigate. | `#explore` (existing label) |
| 6 | **Emergency** | Auto-synthesised. Host phone (tap-to-call), backup host, hospital (tap-to-navigate), national emergency, gas/water/electrical shut-offs with photos, security armed-response. | `/g/:slug/emergency` (separate route, deep-linkable) **and** reachable from the persistent FAB on every page. |

> **Note on the current scaffold:** `GuidebookPage.tsx` ships only Arrival / Your Stay / Explore today. Departure, Emergency, and the explicit Home section are gaps to fill in implementation order steps 3–5.

### 2.2 Forced category taxonomy for House Manual cards

Hostfully's biggest IA failure is that `category` is nullable on `information` and every host leaves it null, producing a flat 14-card grid. **We will not allow this.** The `guidebook_house_manuals.category` column stays nullable in the database (existing schema), but the **admin editor enforces a non-null pick from a fixed enum, and the guest surface groups by category with no "Uncategorised" bucket.**

The fixed enum (use these exact strings as the canonical labels):

1. **Safety** — fire extinguisher, first aid kit, smoke alarms, security armed-response, emergency contacts within the home.
2. **Connectivity** — WiFi, mobile signal notes, smart-TV / streaming logins, Bluetooth speakers.
3. **Appliances** — kitchen (oven, hob, dishwasher, microwave, coffee machine), laundry (washer, dryer, iron), HVAC (aircon, heaters), media (TV, AV receiver, remotes).
4. **Access** — keys, gate remotes, alarm codes, lockboxes, key-handover protocol, garage codes.
5. **House Rules** — quiet hours, smoking, parties, pets, max occupancy, no-shoes zones.
6. **Outdoors** — pool, jacuzzi, braai/BBQ, garden, irrigation, outdoor lighting, sun loungers.
7. **Local Context** — load-shedding, water restrictions, neighbourhood quirks, trash days, post.
8. **Emergencies** — hospitals, doctors, gas/water/electricity shut-offs, evacuation. (Mirrors and feeds the auto-synthesised Emergency page — see §4.6.)

Implementation note: store the enum in a TypeScript module `src/lib/guidebookTaxonomy.ts` so both the admin editor and the guest renderer pull from one place. The seed migration already uses strings close to these (`'Arrival'`, `'House rules'`, `'Outside the home'`, `'Inside the home'`, `'Utilities'`, `'Errands'`, `'Transport'`, `'Safety'`, `'Care of the home'`); a follow-up migration should normalise them. Until that migration runs, the renderer should map legacy → canonical at read time.

### 2.3 Privacy tiers

Two tiers. **The default is `guest_only` for anything sensitive.** This is the opposite of Hostfully and the single biggest security-and-privacy win.

| Tier | Visibility | Default-for |
| --- | --- | --- |
| **`public`** | Anyone with the URL | Property name, hero image, host first name + photo (no contact info), neighbourhood, generic welcome, recommendations, generic arrival prose ("Check-in is from 3pm. The host will meet you at the property.") |
| **`guest_only`** | Gated by reservation code OR signed magic-link | Full address, exact directions, WiFi SSID/password, alarm codes, gate codes, lockbox codes, host phone number, backup host phone number, armed-response password, any field tagged `Safety > armed-response` or `Access > codes` |

Implementation:

- Add a `privacy_tier text not null default 'guest_only' check (privacy_tier in ('public','guest_only'))` column to `guidebooks` (for whole-guidebook fields like `wifi_password`) and to `guidebook_house_manuals` (for per-card fields). Whole-card field tiers, not per-field-on-a-card — keeps it simple.
- Add a `guidebook_access_tokens` table: `id, guidebook_id, token text unique, reservation_ref text, expires_at, revoked_at`. The guest enters a 6–8 character code (case-insensitive) or hits a magic link `?t=<token>`; the page caches the validated state in `sessionStorage` for the tab lifetime.
- Server-side: an Edge Function `guidebook-fetch-private` accepts the token, validates against `guidebook_access_tokens`, and returns the `guest_only` payload. The public RLS policies stay as they are.
- Client-side: the page always renders the `public` shell, then triggers a `guest_only` fetch on mount if a token is present; sensitive cards render a "Locked — enter your stay code" stub until unlocked.

**Default tier per field** (the answer to "which fields default to which tier"):

| Field | Default tier |
| --- | --- |
| `property_name`, `hero_image_url`, `host_name` (first name only), `country_code`, `city` | `public` |
| `street_name`, `street_number`, `postal_code` (full address) | `guest_only` |
| `wifi_ssid` | `guest_only` (yes, even the SSID — knowing the SSID + property location is enough to map it) |
| `wifi_password` | `guest_only` (always) |
| `checkin_text`, `directions_text`, `parking_text`, `checkout_text` | `guest_only` (they reveal arrival timing and entry method) |
| Manual cards in categories `Safety`, `Access` | `guest_only` |
| Manual cards in categories `Connectivity`, `Appliances`, `House Rules`, `Outdoors`, `Local Context`, `Emergencies` | `public` (the *content* of emergencies — hospital numbers etc. — is fine to be public; the *codes* live under Access) |
| All `guidebook_recommendations` | `public` |

### 2.4 Mandatory persistent UI

These three elements appear on **every** guest page (Home, Arrival, House Manual, Departure, Recommendations, Emergency). They are not optional and they must survive scroll, route change, and modal open.

1. **Global search (Cmd+K / `/` / tap the search pill).** Indexes WiFi, every manual card, every recommendation, every appliance name, the property address. Fuzzy match. Source attribution on each result ("Found in House Manual → Safety"). Mirror the existing `src/components/GlobalSearchModal.tsx` shell (it already lives on a tested ActionModal foundation — see §4.7).
2. **Emergency CTA.** A round, brand-coloured floating action button (FAB) bottom-right on mobile, top-right header chip on desktop. Single tap opens the Emergency page in a modal (or routes to `/g/:slug/emergency` on direct deep-link). Label: "Emergency". Icon: ⚠ stroke triangle. Background: `#DC2626` (the design system `--color-danger`). This is **NEVER** more than one tap away.
3. **Host-contact chip.** A pinned header chip "Hayley · Call / WhatsApp" with two tap targets: `tel:` and a WhatsApp deep-link (`https://wa.me/27...`). On mobile, this collapses to a floating bottom-left FAB if the user has scrolled past the host card. Tap-to-call **must** be a real `<a href="tel:">` so iOS/Android dialer intents fire — not a button with an onClick handler.

---

## 3. Visual Design System (the canonical reference)

This section repeats the design tokens verbatim so the next session does not need to re-read `src/app.css`. Wherever the admin editor and the guest surface diverge, both are spelled out.

### 3.1 Color palette

```css
/* ── Brand (admin chrome + admin editor) ─────────────────────── */
--color-primary:        #0F4C75;  /* primary buttons, links, active states */
--color-primary-hover:  #0B3D5E;  /* hover variant */
--color-primary-light:  #3282B8;  /* form-label color (hardcoded — see §3.13 gotchas) */
--color-primary-bg:     #EBF5FB;  /* ultra-light hover/selection tint */
--color-secondary:      #1B262C;  /* sidebar background, dark neutral */

/* ── Neutrals (both surfaces) ────────────────────────────────── */
--bg:                   #F3F4F6;  /* page background */
--surface:              #FFFFFF;  /* cards, modals */
--border:               #E5E7EB;  /* standard divider */
--border-light:         #F3F4F6;  /* subtle divider */
--text:                 #111827;  /* primary body */
--text-secondary:       #4B5563;  /* descriptions, metadata */
--text-light:           #6B7280;  /* captions */
--text-muted:           #9CA3AF;  /* disabled, placeholders */
--text-placeholder:     #D1D5DB;  /* input placeholder */

/* ── Semantic ────────────────────────────────────────────────── */
--color-success:        #059669;  /* bg #D1FAE5 */
--color-danger:         #DC2626;  /* bg #FEE2E2  — also the EMERGENCY color */
--color-accent-warm:    #D97706;  /* warnings, drafts; bg #FEF3C7 */
--color-info:           #2563EB;  /* info; bg #DBEAFE */

/* ── Brand specials (DO NOT centralise — see §3.13) ──────────── */
--color-hero:           #d4af37;  /* brochure GOLD — hero badges, gold rules */
                                  /* DIFFERENT from primary blue */
--brochure-grey:        #6D6D6D;  /* sampled brochure grey, takes precedence */
                                  /* over system greys for brochure copy */
--color-whatsapp:       #25D366;  /* hardcoded, NOT a variable */
--color-whatsapp-hover: #128C7E;  /* hardcoded */

/* ── Seasonal pricing (admin only — irrelevant to guidebook) ── */
--season-peak: #DC2626; --season-high: #D97706;
--season-mid:  #059669; --season-low:  #2563EB;
```

**Guest-surface palette (brochure language).** The guest pages use a softer, magazine palette layered over the brand tokens:

```css
/* Guest-surface additions — define alongside the existing tokens   */
--gb-cream:   #FBF8F2;  /* primary background for Arrival section   */
--gb-linen:   #F4EFE6;  /* secondary background for Explore section */
--gb-paper:   #FFFFFF;  /* canvas/card surface                      */
--gb-ink:     #1a1a1a;  /* primary text on cream/linen              */
--gb-gold:    #d4af37;  /* gold rules, eyebrow underlines, hero accent */
--gb-grey:    #6D6D6D;  /* secondary text, metadata, captions       */
```

These are inspired by the existing brochure typography in `public/brochure.html` and the wordmark commits (7ed8620, c1949d9). The current `GuidebookPage.tsx` already implies them through class names like `gb-section--cream`, `gb-section--linen`, `gb-section--white`. Make them real CSS variables when you wire styles.

### 3.2 Typography

Both surfaces import the same Google Fonts (`index.html` line 11). The current font set is sufficient — do not add new font families.

```html
<!-- Already in index.html -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700
            &family=Questrial
            &family=Yellowtail
            &family=Montserrat:wght@600;800;900
            &family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500
            &display=swap" rel="stylesheet">
```

If `Pacifico` (used in the brochure wordmark in `GuidebookPage.tsx`'s hero) is missing from `index.html`, add it:

```html
<link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet">
```

#### Font families by role

| Role | Family | Stack |
| --- | --- | --- |
| Admin chrome (sidebar, modals, forms, tables) | **Inter** | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| Guest body copy & cards | **Inter** | same |
| Guest section headings (eyebrows + section titles) | **Playfair Display** | `'Playfair Display', 'Times New Roman', serif` |
| Guest wordmark "Southern" | **Pacifico** (script) | `'Pacifico', 'Yellowtail', cursive` (Yellowtail is a fallback already loaded) |
| Guest wordmark "ESCAPES" | **Montserrat 800** | `'Montserrat', 'Inter', sans-serif` (`font-weight: 800`, `text-transform: uppercase`, wide tracking) |
| Mono (WiFi password, codes) | **System mono** | `ui-monospace, 'SF Mono', Menlo, monospace` |

#### Type scale (HTML base = 15px → 1rem)

```
                  size      weight  line-h  used for
---------------- --------- ------- ------- --------------------------
h1 (page hdr)    1.125rem    600    1.3    admin page titles
h2 (section)     1.5–2rem    600    1.2    guest section titles (Playfair)
detail-modal     1.125rem    700    1.2    detail modal headers
action-modal     1.0625rem   700    1.2    action modal headers
guest hero       2.5–3.5rem  600    1.05   property name on hero (Playfair italic)
property card    0.9375rem   600    —      admin property card title
brochure card    0.875rem    600    —      admin brochure card title
sidebar brand    1rem        700    —      "Southern Escapes" in sidebar
sidebar link     0.8125rem   500    —      sidebar nav item
sidebar child    0.78125rem  400/600 —     sidebar child nav (600 when active)
body text        0.8125rem   500    1.5    body — note 500 (NOT 400) is mandatory
form label       0.75rem     800    —      uppercase, letter-spacing 0.08em
table header     0.6875rem   700    —      uppercase, letter-spacing 0.06em
section heading  0.6875rem   700    —      uppercase, letter-spacing 0.08em
badge/pill       0.625rem    700    —      uppercase, letter-spacing 0.04–0.06em
caption          0.75rem     400–600 —     metadata, timestamps
eyebrow (guest)  0.75rem     600    —      uppercase, letter-spacing 0.18em, Inter
```

Always reference these by role, never by raw px. If a number is missing here it's intentional — invent the closest scale match, do not introduce a new size.

### 3.3 Spacing scale

```css
--s-1:  4px
--s-2:  8px
--s-3:  12px
--s-4:  16px   /* most common */
--s-5:  20px
--s-6:  24px
--s-8:  32px
--s-12: 48px
```

Common padding patterns (precedent set by existing code, follow it):

| Element | Padding |
| --- | --- |
| Card / modal body | `16px–20px` horizontal, `12px–16px` vertical |
| Button (tight) | `6px 12px` |
| Button (standard) | `8px 14px` |
| Form input | `7px 10px` (off-scale but precedent) |
| Section gap inside modal body | `12px–24px` |
| Guest section vertical rhythm | `64px` (mobile) / `96px` (desktop) between top-level sections |
| Guest canvas inner padding | `20px` (mobile) / `64px` (desktop) |

### 3.4 Border radius

```css
--radius:    10px;   /* cards, large containers */
--radius-sm: 6px;    /* buttons, inputs, small controls */
/* Hardcoded variants you'll see in app.css:
   4px  — small chips, table pagination buttons
   8px  — gallery tiles, brochure editor sections, guest manual cards
   12px — modals (NOT in a variable, hardcoded)
   20px or 999px — pills, FABs, fully rounded */
```

For the guidebook: use `10px` for guest manual cards and recommendation cards; use `6px` for chips, copy buttons, and inputs in the admin editor; use `999px` for the emergency FAB and host-contact chip.

### 3.5 Shadow scale

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04);                                          /* cards at rest */
--shadow:    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);              /* standard */
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);    /* cards on hover, popovers */
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04);  /* modals */

/* Specials */
fab-hover:        0 6px 18px rgba(15,76,117,0.4);
fab-emergency:    0 6px 18px rgba(220,38,38,0.45);                                /* matches --color-danger */
modal-overlay-bg: rgba(15, 23, 42, 0.55);  backdrop-filter: blur(4px);
action-modal:     0 24px 60px rgba(0,0,0,0.22), 0 8px 16px rgba(0,0,0,0.08);
```

### 3.6 Buttons

Reference: `src/app.css:240` onwards (`.btn` and variants). All buttons follow:

```
padding: 6px 12px (tight) | 8px 14px (standard)
font-size: 0.8125rem
font-weight: 500
border-radius: 6px
display: inline-flex; align-items: center; justify-content: center; gap: 5px
border: 1px solid transparent
cursor: pointer
transition: 0.15s ease
line-height: 1.4
disabled: opacity 0.45, cursor not-allowed, pointer-events none
focus-visible: outline 2px solid #3282B8, outline-offset 1px
```

| Class | Background | Color | Border | Hover BG | Hover Color |
| --- | --- | --- | --- | --- | --- |
| `.btn-primary` | `#0F4C75` | `#fff` | transparent | `#0B3D5E` | `#fff` |
| `.btn-secondary` | `#F3F4F6` | `#111827` | `#E5E7EB` | `#E5E7EB` | `#111827` |
| `.btn-outline` | transparent | `#4B5563` | `#E5E7EB` | `#F9FAFB` | `#111827` |
| `.btn-ghost` | transparent | `#4B5563` | none | `#F3F4F6` | `#111827` |
| `.btn-outline-success` | transparent | `#059669` | `#059669` | `#D1FAE5` | `#065F46` |
| `.btn-outline-danger` | transparent | `#DC2626` | `#DC2626` | `#FEE2E2` | `#991B1B` |
| `.btn-outline-primary` | transparent | `#0F4C75` | `#0F4C75` | `#EBF5FB` | `#0B3D5E` |
| `.btn-whatsapp` | `#25D366` | `#fff` | `#25D366` | `#128C7E` | `#fff` |
| `.btn-outline-whatsapp` | transparent | `#25D366` | `#25D366` | `#E7F8EE` | `#128C7E` |

**New guest-surface button variants to add:**

```css
/* Emergency CTA — used by the FAB and the Emergency page action row */
.btn-emergency {
  background: var(--color-danger);
  color: #fff;
  border: 1px solid var(--color-danger);
}
.btn-emergency:hover { background: #B91C1C; border-color: #B91C1C; }

/* Tap-to-call link styled as a button — anchor element <a href="tel:"> */
.btn-tel {
  background: var(--color-primary);
  color: #fff;
  border: 1px solid var(--color-primary);
}
.btn-tel:hover { background: var(--color-primary-hover); }

/* Copy button — minimal, appears next to copyable values */
.btn-copy {
  padding: 4px 10px;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.btn-copy:hover { background: var(--bg); color: var(--text); }
.btn-copy.is-copied { background: var(--color-primary-bg); color: var(--color-primary); border-color: var(--color-primary-light); }
```

### 3.7 Cards

```
.card  background: #FFFFFF
       border: 1px solid #E5E7EB
       border-radius: 10px
       box-shadow: var(--shadow-sm)

.card:hover (interactive cards only)
       box-shadow: var(--shadow-md)
       transform: translateY(-2px)
```

**Guest manual card** extends this with: photo at top (16:9, `border-radius: 10px 10px 0 0`, optional), 14px–20px padding, category eyebrow above title, expandable body. See §4.4.

### 3.8 Modals (the canonical pattern, used by Emergency, Search, etc.)

There are **three modal shells** in this codebase. **Pick the right one — do not invent a fourth.**

- **`.modal` (standard, `src/app.css:814–876`)** — light modal for confirmations, simple forms. `max-width: 520px`, overlay z-index 200, blur backdrop.
- **`.action-modal` (`src/app.css:2136–2286`)** — heavier shell with optional side/right-docked placement. **Use this for the Emergency modal and the Global Search modal** (the latter already uses it — see `GlobalSearchModal.tsx`). `max-width: 520px` default; `--side: 480px`; `right` placement gives a transparent overlay so the underlying page remains interactive.
- **`.detail-modal` (`src/app.css:2294–2478`)** — the big editor modal with accent strip, mode badge, larger max-width (880px). **Use this for the admin guidebook editor's per-section edit dialogs.**

Modal overlay:

```
.modal-overlay   position: fixed; inset: 0
                 background: rgba(15, 23, 42, 0.55)
                 backdrop-filter: blur(4px)
                 display: flex; align-items: center; justify-content: center
                 z-index: 200 (standard) / 250 (right-docked)
                 padding: 16px
```

### 3.9 Forms

```
.form-group      margin-bottom: 6px
.form-label      0.75rem / 800 / UPPER / letter-spacing 0.08em / color #3282B8 / margin-bottom 4px
.form-input      width 100%; padding 7px 10px; border 1px solid #E5E7EB; border-radius 6px;
                 font-size 0.8125rem; font-weight 500; color #111827; background #fff
  :focus         border-color #3282B8; box-shadow 0 0 0 2px rgba(50,130,184,0.08)
  ::placeholder  color #D1D5DB
textarea         resize: vertical; min-height 60px
select           cursor: pointer
.form-grid-2     display: grid; grid-template-columns 1fr 1fr; gap 10px 14px
```

**Guidebook editor needs a rich-text editor.** Do NOT roll your own. The existing `body_html` columns suggest TipTap or a similar minimal editor. Restrict toolbar to: bold, italic, link, unordered list, ordered list. Strip pasted styles (the Hostfully data was full of inline-style leakage; we will not repeat that).

### 3.10 Tables (admin editor only)

`src/app.css:640–718`. For the admin list view of guidebooks:

```
.data-table              width 100%; border-collapse collapse
th                       padding 10px 16px; 0.6875rem / 700 / UPPER / letter-spacing 0.06em
                         color #4B5563; bg #F3F4F6; border-bottom 2px solid #E5E7EB
td                       padding 11px 16px; 0.8125rem / 500; color #111827
                         border-bottom 1px solid #F3F4F6
tbody tr:hover           background #F3F4F6
.table-row-clickable     cursor: pointer; hover bg #EBF5FB
```

### 3.11 Badges, toasts, empty states

- **Status badge** (`.status-badge`): `0.6875rem` / 600 / `border-radius: 10px`. Semantic: success `bg #D1FAE5 / #059669`, warning `bg #FEF3C7 / #D97706`, error `bg #FEE2E2 / #DC2626`, info `bg #DBEAFE / #2563EB`.
- **Toast** (`.toast`, `src/app.css:3692`): `border-left: 4px solid var(--color-info)` etc. — use for "Copied!" feedback when the user taps a copy button.
- **Empty state** (`.empty-state`, `src/app.css:732`): centered, `2.5rem` icon, `1rem/600` title, `0.875rem` light grey description, optional CTA. Use for "No recommendations yet" and "Guidebook not published yet" states.

### 3.12 Sidebar / navigation expectations for the admin editor

The admin editor lives **inside the existing admin portal sidebar**. Reference: `src/app.css:82–286`.

Add a top-level sidebar link "Guidebooks" between the existing "Brochures" and the next entry. It uses:

```
.sidebar-link               padding 8px 10px; border-radius 6px; font-size 0.8125rem; font-weight 500
.sidebar-link-icon          18px × 18px; flex-shrink 0
.sidebar-link inactive      color rgba(255,255,255,0.78); bg transparent
.sidebar-link hover         color rgba(255,255,255,0.95); bg rgba(255,255,255,0.05)
.sidebar-link active        color #fff; bg rgba(255,255,255,0.08)
```

Icon: use the existing inline-SVG pattern (see `GuidebookPage.tsx`'s `<Icon>` component). Suggested glyph: open-book or compass.

### 3.13 The 10 patterns to preserve

These are non-negotiable for visual consistency with the rest of the platform.

1. **Card elevation pattern** — `var(--shadow-sm)` at rest, `var(--shadow-md)` + `translateY(-2px)` on hover, `0.15s ease` transition. Apply to every interactive card in both surfaces.
2. **Modal architecture** — overlay (z-200/250) + shell + header + body (scrollable) + footer. `--shadow-lg`, `border-radius: 12px`. Detail modal additionally has the 5px accent strip and the mode badge.
3. **Semantic colour set** — Success/Error/Warning/Info, used for badges, toasts, mode badges, and form feedback. Always together (background + foreground from the same pair).
4. **Form labels** — `0.75rem` / 800 / uppercase / `letter-spacing 0.08em` / color `#3282B8`. This is the deliberate hierarchy — labels look light because the values look heavy (`500` weight at `0.8125rem`).
5. **Section headings inside modals** — `0.6875rem` / 700 / uppercase / `letter-spacing 0.08em` / `var(--text-secondary)`. Matches table headers.
6. **Table design** — uppercase 700 headers in light-grey background; 500-weight body in `0.8125rem`; row hover shifts to `var(--bg)`.
7. **Button pairing** — two-CTA footer is always primary + secondary, or primary + ghost. Destructive actions always `.btn-outline-danger`. Brand-coloured tap-to-call gets a new `.btn-tel` (above).
8. **Pill / chip components** — `border-radius: 20px`, pill-shaped, `0.75rem` font. Active: dark primary background, white text. Inactive: light grey, darker text.
9. **Empty states** — icon (2.5rem) + title (1rem/600) + description (0.875rem light grey) + optional CTA. Centered.
10. **Skeleton shimmer** — gradient animation `1.4s ease-in-out infinite`. Use for the guest guidebook initial load (replaces the current spinner in `GuidebookPage.tsx`).

### 3.14 The 10 fragile patterns / gotchas

Each of these will break something if you forget it. Read all ten before writing CSS.

1. **Modal z-index stacking.** `200` standard, `250` right-docked, `5000` toasts. If you add a new overlay variant, pick deliberately — do NOT default to a new arbitrary value. The Emergency modal should be `300` (above standard, below toasts).
2. **Form label colour is hardcoded `#3282B8` (`--color-primary-light`), NOT `--text-secondary`.** If you forget this, labels look like body text and the hierarchy collapses.
3. **Brochure gold `#d4af37` is NOT brand blue.** Hero badges, gold rules, eyebrows-on-cream all use the gold. The CSS variable name `--color-hero` is correct; don't replace with `--color-primary`.
4. **Brochure grey `#6D6D6D` is a sampled colour, NOT a system grey.** Use it verbatim for brochure / guest-surface secondary text. Don't replace with `var(--text-light)`.
5. **WhatsApp green `#25D366` / `#128C7E` is intentionally not variable-ized.** Brand hex is canonical, immutable. Keep it as a literal in `.btn-whatsapp` and any new WhatsApp deep-link.
6. **Sidebar inactive link opacity is `0.78`, NOT `0.6`.** Bumped for WCAG AA. Don't regress.
7. **Body font-weight is `500` globally, NOT `400`.** Don't override individual blocks back to 400 — it breaks the label-vs-value hierarchy.
8. **Global `box-sizing: border-box` is on `*` and pseudos.** Don't introduce content-box.
9. **Responsive breakpoints are scattered, not centralised.** Sidebar 768, modal 600/768, mobile filters 768, single-column 480. For the guidebook, treat 768, 600, 480 as the canonical guest-surface breakpoints (§5).
10. **Border radius is not consistently abstracted.** Modals use `12px` (hardcoded), cards use `10px` (variable), buttons use `6px` (variable), pills use `999px`. Pick by element class, not by intuition. For the guest manual card: `10px`. For the guest copy button: `6px`. For the FAB / chip: `999px`.

---

## 4. Component-by-Component Specification

Each subsection is a build spec for the next session: **purpose, layout, styling references back to §3, states, accessibility**. Build them in the order listed in §8.

### 4.0 Notes that apply to all guest components

- Use the existing inline-SVG `<Icon>` component pattern from `src/pages/GuidebookPage.tsx:74–95`. Extend it with new glyphs as needed (phone, message, copy, emergency-triangle, navigate, hospital, gas, water, lightning). Always `stroke="currentColor"`, 1.6px line, 24×24 box.
- Every image: lazy-load with `loading="lazy"`, has `alt` text (host-edited; the admin editor must require it).
- Every phone number: render as `<a href="tel:+27...">`; never as button-with-onClick.
- Every address: render as `<a>` with `href="https://www.google.com/maps/search/?api=1&query=<encoded address>"` (cross-platform — Android opens Google Maps, iOS opens Maps via Universal Link).
- Every WhatsApp: `<a href="https://wa.me/27<number-no-leading-zero>">`.
- Sanitise all `body_html` with DOMPurify before `dangerouslySetInnerHTML`. The current `GuidebookPage.tsx` does NOT — that is a known gap to close.

### 4.1 Guest Home

**Route:** `/g/:slug` (default — same route as the page, top section).

**Purpose:** the "what is this" + "5 most-needed answers" landing. A guest at the airport opens this and gets the WiFi password copied to clipboard before they've finished reading the welcome.

**Layout (top-to-bottom):**

1. **Cinematic hero** (existing — keep, refine).
   - Full-bleed `min-height: 70vh` (mobile) / `80vh` (desktop) background image (`hero_image_url`).
   - Layered gradient: `linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.35) 100%)`.
   - Centered SE wordmark (`Pacifico` + `Montserrat 800` per §3.2).
   - Eyebrow "Your Guidebook" (`0.75rem` / 600 / uppercase / `letter-spacing: 0.18em` / white).
   - Property name `<h1>` (Playfair Display italic, `2.5rem` mobile / `3.5rem` desktop, weight 500).
   - Address line (cream secondary text, only renders if `guest_only` unlocked OR the public-safe variant — e.g. "Constantia, Cape Town").
   - Scroll cue at bottom (existing).
2. **Quick-actions strip** (NEW — this is the heart of the home page).
   - Sticks just under the hero, **NOT** under the nav. On mobile, it's a horizontal scroll of five chips; on desktop, a single row.
   - 5 chips, each a tap target ≥44×44px:
     - **WiFi** — icon `wifi` + label "WiFi" — tap to expand inline; reveals SSID + password with one-tap copy + toast.
     - **Check-out** — icon `clock` + label "Check-out 10am" — tap scrolls to Departure section.
     - **Call host** — icon `phone` + label "Hayley" — `<a href="tel:">`, NOT a tap-to-expand.
     - **Emergency** — icon `alert` + label "Emergency" — `<a href="/g/:slug/emergency">`, red `#DC2626` background.
     - **Address** — icon `map` + label "Address" — tap copies full address + opens Maps deep-link.
   - Styling: white background card, `border-radius: 999px`, `border: 1px solid var(--border)`, `padding: 8px 14px`, `gap: 8px`, `font-size: 0.8125rem`, `font-weight: 600`. Each chip has its own subtle accent — Emergency is danger-red; the rest pick up `--color-primary`.
3. **Host card** (existing pattern, refine).
   - Centered, max-width 520px on the cream canvas.
   - Round host photo (96px), name, one-paragraph welcome (Playfair italic, `1.125rem`, line-height 1.55).
   - Below welcome: **two big buttons** — `Call Hayley` (`.btn-tel`) and `WhatsApp Hayley` (`.btn-whatsapp`). On mobile these are 100% width, stacked; on desktop they sit side-by-side.
   - If a backup host is set, render a smaller secondary line "Or message Nicki" with the same two-button pair.
4. **What's in your guidebook** — a short table-of-contents (Arrival / Stay / Departure / Explore / Emergency) as anchor links with the existing `gb-section-head` styling. Optional — only if the host hasn't disabled the section.

**States:**

- **Loading:** skeleton hero (large grey rectangle) + skeleton quick-actions row (5 grey pills). NOT a spinner.
- **No hero image:** solid `var(--gb-cream)` fallback with the wordmark and property name overlaid.
- **`guest_only` not yet unlocked:** quick-actions show, but WiFi and Address chips render a small lock icon and open the unlock modal on tap.
- **Empty welcome:** hide the host card; do not render a placeholder.

**Accessibility:**

- Hero `<h1>` is the page heading; no `<h2>` between hero and quick-actions.
- Quick-action chips are real `<a>` or `<button>` with `aria-label` matching the visible label.
- Emergency chip has `aria-label="Emergency contacts and shut-offs"` (more descriptive than the visible "Emergency").

### 4.2 Arrival page

**Route:** `/g/:slug#arrival` (existing). Refine the current scaffold (`GuidebookPage.tsx:261–280`).

**Purpose:** check-in time, instructions, directions, parking, WiFi. Sections 2.3 and 4.1 already covered most.

**Layout:**

- Section head: eyebrow "Section One" (existing) → "Section One: Arrival" or just "Arrival".
- Grid of arrival cards on `var(--gb-cream)`:
  - **Check-in card** (`gb-arrival-card`): icon clock, title "Check-in", body = `checkin_text` HTML. Below the body: a single inline CTA "WhatsApp Hayley to confirm arrival" (link).
  - **Directions card**: icon map, title "Directions". Body is **NOT** a wall of HTML prose. Instead:
    - 1-line summary "22 km from Cape Town International — about 25 minutes".
    - **Embedded static map** (Google Static Maps API or Mapbox Static — see §10 open Q) of the property location.
    - Two CTAs side-by-side: `Open in Maps` (Google Maps deep-link) and `Share address` (uses Web Share API on mobile, falls back to copy).
    - Collapsible `<details>` "Written directions" — only renders the `directions_text` HTML on demand, defaulting closed.
  - **Parking card** (`gb-arrival-card`): icon car, title "Parking", body = `parking_text`.
  - **WiFi card** (`gb-arrival-card--wifi`, existing pattern):
    - Two rows — Network and Password.
    - Each row has the value rendered in **monospace** (Password row is mono and `font-weight: 600`) + a `.btn-copy` to the right.
    - On tap → copies + toast "WiFi password copied".
    - Beneath, `wifi_notes` rendered as prose (e.g. "Guest network only — host network is private").
    - If `wifi_password` is `guest_only` and not unlocked, show a lock icon + "Enter your stay code to reveal" inline CTA.
  - **Check-out card** (full-width, existing): icon key, title "Check-out", body = `checkout_text`.

**States:**

- **Locked state for `guest_only` fields:** the card renders but values show 6 grey blocks ("●●●●●●") and a lock icon; tapping opens the unlock modal (see §4.10).
- **Empty card** (any one of these is null): hide the card, do not render a "TBD" placeholder.

**Accessibility:**

- The map embed has an alt text "Map showing the property at 9 Montrose Terrace, Constantia, Cape Town".
- The Open in Maps button has `aria-label="Open property location in maps app"`.
- The copy button has `aria-label="Copy WiFi password"` and announces "WiFi password copied to clipboard" via `aria-live="polite"` toast region.

### 4.3 House Manual (Your Stay)

**Route:** `/g/:slug#stay`.

**Purpose:** Replace Hostfully's flat 14-card grid with **grouped, expandable cards** under the 8 fixed categories from §2.2.

**Layout:**

- Section head identical pattern to existing.
- **Category groups**, in this exact order: Safety → Connectivity → Appliances → Access → House Rules → Outdoors → Local Context → Emergencies.
- Each group:
  - Group header: small uppercase eyebrow (e.g. "01 — Safety"), gold rule.
  - List of manual cards belonging to that category, ordered by `position`.
  - If no cards in a category, **skip the group entirely** (don't render an empty header).
- Manual card (`gb-manual-card`, extend existing):
  - Number badge (existing, `01`, `02`, …) — left side on desktop, top-left on mobile.
  - Icon (24px, from `<Icon>`) above title.
  - Category eyebrow (uppercase `0.6875rem` / 700 / `letter-spacing: 0.08em` / colour `var(--brochure-grey)`).
  - Title (Playfair Display, `1.25rem`, `font-weight: 600`).
  - **Optional photo** (16:9, top of card, `border-radius: 10px 10px 0 0`) — render if `image_url` present on the manual. The schema doesn't currently expose `image_url` on `guidebook_house_manuals` — **a follow-up migration must add it**: `alter table guidebook_house_manuals add column image_url text;`. Photo-first is the Hostfully leapfrog (their "where's the gas shut-off" is prose; ours is a photo).
  - Body: `body_html` (or `override_body_html` from the assignment, take whichever is non-null with override winning) rendered through DOMPurify into `.gb-prose`.
  - **Expand/collapse** — default collapsed on mobile (show only title + photo thumb + first line); always expanded on desktop. Use `<details>` for accessibility-free collapse.
  - "Updated 12 days ago" timestamp at the bottom right of each card (from `updated_at`).

**States:**

- **Locked card** (privacy_tier guest_only, not unlocked): renders title + category + lock icon + "Reveal with stay code" link.
- **Empty body**: shouldn't ship — admin editor validates non-empty `body_html` at save time.

**Accessibility:**

- Each `<details>` has a meaningful `<summary>` (the title) so screen readers announce it as a disclosure.
- Icons are decorative (`aria-hidden="true"`) because the title carries the label.

### 4.4 Departure checklist

**Route:** `/g/:slug#departure` (new section to add).

**Purpose:** Hostfully ships zero checkboxes. We ship a real, **persistent, per-device** checklist with progress bar.

**Schema (new migration required):**

```sql
alter table guidebooks
  add column checkout_time time,                          -- e.g. '10:00'
  add column checkout_checklist jsonb not null default '[]'::jsonb;
-- checkout_checklist: [
--   { id: 'lock-doors', label: 'Lock all doors and windows', icon: 'key' },
--   { id: 'dishwasher', label: 'Start the dishwasher on Eco', icon: 'home' },
--   …
-- ]
```

**Layout:**

- Section head "Departure".
- Top card: "Check-out by **10:00am**" — large, friendly, gold rule under it.
- Checkout-text prose card (`checkout_text`).
- **Progress bar** under the title: animates `0% → 100%` as the user checks items. Stored in `localStorage` keyed by `gb-:slug-checklist` so it persists per device.
- **Checklist** — vertical list of items. Each row:
  - 24×24 custom checkbox (the admin chrome has no `.checkbox` style — define one now; see §3.14 gotcha #11 and §3.13 pattern #3).
  - Item icon (optional) from the JSONB.
  - Item label (Inter, `1rem`, `font-weight: 500`).
  - When checked: label gets `text-decoration: line-through`, opacity `0.55`, icon turns `var(--color-success)`.
- Bottom action: `Reset checklist` (`.btn-ghost`).

**States:**

- **No checklist defined** (empty JSONB): hide the checklist, show only the check-out time + prose.
- **All items checked:** confetti micro-animation (one-shot CSS keyframe) + a green "Safe travels — thank you for staying with us" line.

**Accessibility:**

- Custom checkboxes are real `<input type="checkbox">` wrapped in a `<label>`. CSS hides the native input visually but keeps it focusable.
- Progress bar has `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.

### 4.5 Recommendations (list + map dual view)

**Route:** `/g/:slug#explore` (existing). Extend the scaffold (`GuidebookPage.tsx:315–363`).

**Purpose:** the curated places list. Already half-built — needs **category chips, map view, tap-to-navigate, descriptions**.

**Layout:**

- Section head "Explore" (existing).
- **View toggle** under the header (`.view-toggle` pattern, §6.1 of the CSS audit): "List" / "Map". Default to **List on mobile, Map on desktop wider than 1024px** (per the teardown: guests browse on mobile in list, plan on desktop in map).
- **Category chip row** (horizontal scroll on mobile): "All" + one chip per category present in the data. Tapping a chip filters in place. Active chip: dark primary background, white text.
- **List view** (existing grid):
  - `repeat(auto-fill, minmax(280px, 1fr))` on desktop; single column on mobile.
  - First card in each category gets `gb-rec-card--featured` (larger image, existing).
  - Each card: image (4:3), category pill (small, gold or primary), name (Playfair `1.25rem`), description (max 3 lines, clamp), address with map icon, "Open in Maps" link + optional website link.
  - **Tap the whole card → expand description** if truncated. Tap the address → open Maps. Tap the website → external link with `rel="noopener noreferrer"`.
- **Map view** (new):
  - Full-width interactive map (Mapbox GL JS or Google Maps JS — see §10 open Q).
  - Pins for every recommendation with `lat`/`lng` (the existing schema has these — the seed doesn't populate them but the renderer should still attempt).
  - Tap pin → bottom sheet with the rec card (mobile) or popover (desktop).
  - "Show on map" pill on each list card lets users jump back to map view scrolled to that pin.

**States:**

- **No recs:** existing empty state ("No recommendations yet").
- **Rec without lat/lng in map view:** show a "These places aren't pinned on the map" affordance under the map.
- **Filter applied, no matches:** show "No places in this category".

**Accessibility:**

- View toggle has `role="tablist"`, each button `role="tab"` with `aria-selected`.
- Pins on the map have keyboard-accessible buttons (Mapbox supports `marker.getElement()` for ARIA).
- Color-only category differentiation is forbidden (see §6) — chips always pair colour with the category label text.

### 4.6 Emergency page

**Route:** `/g/:slug/emergency` (new, deep-linkable, **also** reachable as a modal from the FAB on any other page).

**Purpose:** the single most important page. A panicked guest at 11pm reaches a real human or shuts off the gas in one tap.

**Auto-synthesis rule:** the content of this page is assembled from:

1. Host phone + name (from `guidebooks.host_phone` — **new column** to add; the seed currently has `host_name` only).
2. Backup host phone + name (also new columns: `backup_host_name`, `backup_host_phone`).
3. Nearest hospital (new column `nearest_hospital_name`, `nearest_hospital_phone`, `nearest_hospital_address`, `nearest_hospital_lat`, `nearest_hospital_lng`).
4. National emergency numbers (a hardcoded table keyed by `country_code` — ZA: 10111 (SAPS), 10177 (Ambulance), 112 (cell)).
5. Armed-response (new columns `armed_response_company`, `armed_response_phone`).
6. Shut-offs — any manual card in category `Safety` tagged with one of `tag in ('gas-shut-off','water-shut-off','electrical-shut-off')`. **New column** `guidebook_house_manuals.emergency_tag text`.
7. Hospitals and doctors listed in manual cards under category `Emergencies`.

**Layout (mobile-first):**

```
┌──────────────────────────────────────────┐
│ ← Back                          [search] │
├──────────────────────────────────────────┤
│           EMERGENCY                       │  <- huge, danger-red, Playfair
├──────────────────────────────────────────┤
│ ⚠ Life-threatening?                       │
│ Call 10111 (SAPS) or 10177 (Ambulance)   │  <- huge tap-to-call buttons
│   [    Call 10111   ]                    │
│   [    Call 10177   ]                    │
├──────────────────────────────────────────┤
│ Call your host                            │
│   Hayley   [  Call  ] [  WhatsApp  ]     │
│   Nicki    [  Call  ] [  WhatsApp  ]     │
├──────────────────────────────────────────┤
│ Nearest hospital                          │
│   Constantiaberg Mediclinic               │
│   [ Call ] [ Navigate ]                  │
├──────────────────────────────────────────┤
│ Armed response                            │
│   ADT Security · 021 712 4009            │
│   [ Call ]                                │
├──────────────────────────────────────────┤
│ Shut-offs (in the home)                   │
│   Gas    [photo]   Outside scullery       │
│                    behind wooden gate.    │
│   Water  [photo]   Municipal valve on     │
│                    left site boundary.    │
│   Power  [photo]   Main DB board in       │
│                    garage.                │
└──────────────────────────────────────────┘
```

**Styling:**

- Page background: `#FEF2F2` (a very pale danger tint) for the top hero band, white below. This signals "you're in the right place" without making the whole page hostile.
- The "EMERGENCY" title: Playfair Display, `2.5rem`, `font-weight: 600`, colour `var(--color-danger)`. NOT italic (italic feels editorial; this is functional).
- Each section card: `border-radius: 10px`, `border: 1px solid var(--border)`, white surface, `padding: 16px 20px`.
- Tap-to-call buttons: `.btn-tel` styling, but extra-large on this page — `padding: 14px 20px`, `font-size: 1rem`, full width on mobile. The national emergency buttons (10111, 10177) use `.btn-emergency` (danger red).
- Shut-off photos: 80×80 thumbnail beside the prose. Tap to enlarge in a lightbox modal.

**States:**

- **Locked:** even if `guest_only` not unlocked, the Emergency page **always renders** the public-safe parts (national emergency, nearest hospital). Host phone, armed-response, codes hide until unlock. Important: do NOT gate the entire page behind unlock — that defeats the point.
- **Missing host phone or hospital:** still render the page, with a friendly message "Your host hasn't added a phone number yet — try the national emergency numbers above." The admin editor should warn the host loudly if these fields are blank.

**Accessibility:**

- Every tap-to-call is a real `<a href="tel:">` with `aria-label="Call 10111 (South African Police)"` etc.
- Page has `role="main"` and the title is `<h1>` — single H1 because this is its own route.
- Photo lightbox has focus trap and Escape closes.

### 4.7 Global search modal (Cmd+K)

**Route:** open from anywhere via Cmd+K / Ctrl+K / `/` / tapping the search pill in the header.

**Purpose:** answer "where's the WiFi password?" / "fire extinguisher" in one keystroke. The single biggest UX win versus Hostfully.

**Mount pattern (mirror the admin portal):** the modal lives in a single React mount point at the top of the guest app, opened via a `globalSearchEvents`-style event dispatcher OR via React context. **Reuse the `ActionModal` shell** that `GlobalSearchModal.tsx` already uses (`src/components/GlobalSearchModal.tsx:25–119` for the existing pattern).

**Layout:**

- ActionModal shell, `max-width: 640px`, `placement="center"` on desktop, full-screen on mobile (`width: 100vw; height: 100vh`).
- Header: search input (large, `font-size: 1.0625rem`, no border, autofocus). Placeholder: "Search the guidebook — WiFi, hospitals, recommendations…". Right side: a small "Esc" hint chip.
- Body: scrollable result list.
- No footer.

**Index (built once on guidebook load, cached in memory):**

```ts
type SearchDoc = {
  id: string;
  kind: 'wifi' | 'arrival' | 'parking' | 'checkin' | 'checkout' |
        'manual' | 'recommendation' | 'address' | 'host' | 'emergency';
  title: string;
  body: string;          // stripped HTML
  category?: string;
  url: string;           // /g/:slug#anchor
};
```

Build the index by:

- WiFi: one doc per guidebook (`SSID + password + notes`).
- Address: one doc.
- Host: one doc (name + phone).
- Each manual: one doc (title + category + stripped body).
- Each recommendation: one doc (name + category + description + address).
- Emergency aggregate: one doc per emergency contact.

Use **Fuse.js** for fuzzy match (already a common pick — confirm in package.json; otherwise add it). Search across `title`, `body`, `category` with weights `[0.5, 0.3, 0.2]`. Threshold `0.35`. Limit results to 20.

**Result item:**

- Icon (matching the kind).
- Title (highlighted matches with `<mark>`).
- Source attribution chip: "House Manual → Safety" or "Recommendations → Wine & dining". Render with the eyebrow style (`0.6875rem` / 700 / uppercase / brochure grey).
- Short body excerpt (1 line, ellipsised).
- Right side: `↵` icon on hover.
- Tap → close modal, navigate to result URL, scroll to anchor, briefly highlight the target element (CSS animation, `outline: 2px solid var(--gb-gold); animation: fade 1.4s`).

**Keyboard:**

- `Cmd+K` / `Ctrl+K` / `/` to open.
- `↑` `↓` to navigate, `↵` to select, `Esc` to close.

**States:**

- **Empty query:** show "Suggested" — top 6 docs (WiFi, address, host, emergency, check-out time, recommendations index).
- **No results:** "Nothing found — try a different word, or contact your host" with a `Call host` button.
- **Loading the index:** spinner inside the input.

**Accessibility:**

- Input has `role="combobox"`, `aria-expanded="true"`, `aria-controls="search-listbox"`.
- Result list is `role="listbox"`; each item `role="option"` with `aria-selected`.
- Live-region announces "X results for 'wifi'".

### 4.8 Persistent host-contact chip

**Purpose:** the host is always one tap away — call OR WhatsApp.

**Two variants:**

1. **Header chip** (desktop, ≥769px and on guidebook home page mobile before scroll): top-right of the sticky `.gb-nav`. Render:
   - Round host avatar (28px).
   - "Hayley" (Inter, `0.8125rem`, `font-weight: 600`).
   - Two small icon buttons: phone + WhatsApp.
   - Background: white, `border: 1px solid var(--border)`, `border-radius: 999px`, `padding: 4px 8px 4px 4px`.
2. **Floating bottom-left chip** (mobile, after scrolling past 600px): same content, but only the two icon buttons + avatar, no name. `position: fixed; bottom: 16px; left: 16px; z-index: 80`.

The **Emergency FAB** (§2.4) lives at bottom-right with `z-index: 90` so it's above the host chip in the stacking order.

**Accessibility:**

- Both buttons are real anchors (`<a href="tel:">`, `<a href="https://wa.me/...">`).
- `aria-label="Call Hayley"`, `aria-label="WhatsApp Hayley"`.
- Avatar has `alt="Hayley, your host"`.

### 4.9 Admin editor (inside the admin portal)

**Route:** `/guidebooks` (list), `/guidebooks/:id` (editor), `/guidebooks/library/manuals` (shared library), `/guidebooks/library/recommendations` (shared library).

#### 4.9.1 List view

Reuse the existing admin chrome: `.page-header` + `.page-content` + `.data-table`.

- Page title `Guidebooks` (`h1`, `1.125rem`, `font-weight: 600`).
- Right side of header: `+ New guidebook` button (`.btn-primary`).
- Search pill (`.list-search`) to filter by property name / slug.
- Table columns: Property name · Slug · Published · Last updated · Actions.
- "Published" column uses a status badge: success "Published" / warning "Draft".
- Row click → `/guidebooks/:id`.

#### 4.9.2 Detail editor

Use the `.detail-modal` pattern as a full-page layout (NOT in a modal — the editor is too large for a modal; instead, replicate the visual language).

- Top bar: back arrow + property name + slug + status badge + action buttons (Save, Preview, Publish/Unpublish).
- Left sidebar (240px on desktop, collapses to a top tab bar on mobile): sections — `Basics`, `Arrival & Wi-Fi`, `House Manual`, `Recommendations`, `Departure`, `Emergency`, `Privacy & Access`, `Preview`.
- Right panel: the form for the selected section, using `.form-*` patterns.

#### 4.9.3 Section editor (House Manual specifically)

- Two-column layout: left = list of attached manual cards (drag-handle for reorder, X to detach, ↗ to open detail); right = the editor for the selected card.
- "Attach from library" button opens a search-able picker over `guidebook_house_manuals`. Hosts can attach a `is_standard=true` card with an optional override.
- "Create new" opens an inline form: title, category (select from the fixed enum — §2.2), icon (visual picker from the existing icon set), body (rich-text editor), photo (upload), privacy tier.
- Required fields are starred and validated on save. Title and body cannot be blank.

#### 4.9.4 Photo uploads

- Use the existing Supabase Storage pattern (the brochure editor already uploads photos — see references in `src/app.css:3176+`). Suggested bucket: `guidebook-photos`, public read.
- Drag-and-drop drop zone on each photo field; max 5MB; client-side resize to max 2000px on the long edge before upload.
- After upload, store the public URL on the appropriate column (`hero_image_url`, `image_url`, etc.).

**States across the editor:**

- **Unsaved changes:** the `.detail-modal-mode-badge--unsaved` pattern — small warm orange badge in the top bar. Cmd+S to save. Navigating away prompts "You have unsaved changes".
- **Saving:** Save button shows a spinner, disables.
- **Publish:** modal confirm — "This will make the guidebook visible at /g/:slug. Anyone with the link can see the public sections. Make sure your privacy tiers are correct."
- **Validation errors:** inline under the relevant field (red text, `0.75rem`); top of section shows a count.

### 4.10 Stay-code unlock modal

**Purpose:** convert a guest from "anonymous" to "in-stay" so they see `guest_only` fields.

**Trigger:** tapping any locked field, or visiting `/g/:slug?t=<token>` (auto-unlocks).

**Layout:**

- `.action-modal`, `max-width: 420px`, centered.
- Header: "Reveal your stay details".
- Body: short copy ("Enter the 6-character code from your booking confirmation."), single input (6 chars, monospaced, autofocus, autoCapitalize off, autocomplete one-time-code), submit button.
- On success: store the validated token in `sessionStorage` (`gb-:slug-token`), close modal, refresh the page in place. Toast "Unlocked".
- On failure: shake the input, show "That code doesn't match — please check your booking email".
- Link below: "I don't have a code — text my host" → opens WhatsApp deep-link.

**Accessibility:** input has `inputMode="text"`, `autocomplete="one-time-code"` so iOS surfaces the SMS auto-fill suggestion.

---

## 5. Mobile-First Responsive Guidance

Treat the guest surface as mobile-default. Add desktop styles in `@media (min-width: …)`.

### 5.1 Breakpoints (canonical for the guidebook)

| Breakpoint | Trigger | Effect |
| --- | --- | --- |
| `≥480px` (xs) | small phones land here | Quick-action chips stop horizontal scrolling, become a single row. |
| `≥600px` (sm) | large phones / small tablets | Manual cards: title + body side-by-side instead of stacked. Two-column recommendation grid. |
| `≥768px` (md) | tablets / small laptops | Sticky `.gb-nav` becomes horizontal with all section links visible. Recommendations dual view enables (List/Map toggle becomes visible). Sidebar in admin editor expands. |
| `≥1024px` (lg) | desktop | Hero increases to 80vh. Canvas pads to 64px. Recommendations default to map view. Host-contact chip docks in the header (not floating). |

### 5.2 What collapses / stacks at each

| Element | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Quick-actions strip | horizontal scroll (5 chips) | single row | single row, larger |
| Host card buttons | stacked 100% width | side-by-side | side-by-side |
| Arrival grid | single column | two columns | two columns (WiFi card spans) |
| Manual cards | stacked, expand-on-tap | side-by-side title+body, all expanded | all expanded |
| Recommendation list | single column | two columns | three columns or map view |
| Emergency CTA | bottom-right FAB | bottom-right FAB | top-right header chip |
| Host contact | floating bottom-left FAB on scroll | header chip | header chip |
| Search | full-screen modal | centered 640px modal | centered 640px modal |

### 5.3 Tap targets

Every interactive element must be at minimum **44×44px** (Apple HIG) / **48×48dp** (Material). Quick-action chips, copy buttons, FABs all meet this.

### 5.4 Performance budget

- Hero image: 1600px wide max, JPEG quality 80, lazy-loaded with `loading="lazy"` for below-the-fold images.
- Total above-the-fold weight target: ≤ 250 KB (HTML + critical CSS + JS shell + hero image).
- Use `<link rel="preconnect">` for the Supabase URL and the maps tile host.

---

## 6. Accessibility Checklist (WCAG 2.1 AA)

Run through this list at the end of every component. Build the right way the first time — retro-fixing a11y is the slowest possible path.

1. **Color contrast ≥4.5:1** for normal text, ≥3:1 for large text. Verify with WebAIM contrast checker. Specific risks:
   - `var(--brochure-grey)` `#6D6D6D` on `var(--gb-cream)` `#FBF8F2` — verify (it should pass at body sizes; if it fails, bump to `#5A5A5A`).
   - Yellow chips, gold rules — never combine with white text. Gold `#d4af37` on white is **4.5:1 fail** for body; use only for decorative rules and 800-weight badges (large text).
2. **Alt text on every image.** The admin editor forces hosts to enter alt text on photo upload. Empty `alt=""` is acceptable only for decorative images (e.g. the hero, which is described by the H1).
3. **Icons always labelled.** Decorative icons: `aria-hidden="true"`. Functional icons (a button with no text label) must have `aria-label`.
4. **No color-only differentiation.** Category chips combine color + text label. Status badges combine color + icon + text. The map pin clusters use shape + color + count.
5. **Focus rings.** Keep the existing `outline: 2px solid #3282B8; outline-offset: 1px` on focus-visible. Do NOT use `outline: none` anywhere without an alternative.
6. **Tap-to-call honoured by screen readers.** `<a href="tel:+27...">` works in VoiceOver and TalkBack out of the box. Don't wrap in JS handlers.
7. **Keyboard navigation.** Every interactive element reachable by Tab; modal Escape closes; search arrow keys navigate results.
8. **Semantic HTML.** `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`. Not `<div>` soup.
9. **Headings in order.** One `<h1>` per page (the property name on Home; the section title on emergency page; etc.). `<h2>` for sections; `<h3>` for cards; never skip levels.
10. **Forms have labels.** Every input has a `<label for="…">` or `aria-label`. Required fields have `aria-required="true"`.
11. **Live regions for toasts.** The toast container has `role="status"` (or `aria-live="polite"`) so "Copied" announcements are heard.
12. **Reduced motion.** Respect `@media (prefers-reduced-motion: reduce)` — disable the modal-in scale, toast slide, and confetti animations.

---

## 7. Anti-patterns (the Hostfully sin list)

If any of these appear in code review, reject the PR.

1. **Never publish security credentials on a public URL.** Default privacy tier is `guest_only`. The admin editor must REFUSE to mark a WiFi password or alarm code as `public` without an explicit override + warning modal.
2. **Never ship a flat ungrouped grid of manual cards.** Always grouped by the fixed taxonomy (§2.2).
3. **Never bury emergency information inside a regular content card.** Emergency is its own route and its own persistent FAB.
4. **Never make tap-to-call a button-with-onClick.** Must be `<a href="tel:">`.
5. **Never make tap-to-navigate a button-with-onClick.** Must be `<a href="https://www.google.com/maps/...">`.
6. **Never render a wall of unformatted driving prose as "directions".** Embed a map + Open-in-Maps CTA; the prose is a `<details>` fallback.
7. **Never publish duplicate template + property-specific cards side by side.** The admin editor warns when a host attaches both `standard-load-shedding` and a property-specific load-shedding card — they must pick one or use `override_body_html`.
8. **Never let category be null.** Admin editor enforces a pick from the fixed enum.
9. **Never strip phone numbers into prose.** Structured contact fields on the host + backup host + hospital + armed-response. The admin editor REFUSES to save a card body containing a phone number without prompting "Should this be in the Emergency contacts panel instead?".
10. **Never use Material Icons font.** Hostfully relies on them; we use the inline SVG `<Icon>` already in `GuidebookPage.tsx`. Icons render at any size, take currentColor, work offline.
11. **Never index the guest URL in search engines.** Ship a `<meta name="robots" content="noindex,nofollow">` on `/g/*` routes, and a `Disallow: /g/` in `robots.txt`.
12. **Never render `body_html` without sanitisation.** DOMPurify on every `dangerouslySetInnerHTML`.
13. **Never auto-collect emails on a splash screen.** No splash screen. The guest gets straight to content.
14. **Never default to italic body text.** Hostfully's WYSIWYG leaks `<em>` everywhere. Our editor strips it on paste.
15. **Never trust host whitespace.** Trim every text field on read; collapse internal double-spaces on display.

---

## 8. Implementation Order

Dependency-aware, numbered. Each step should be a separate PR. **Do not parallelise — each step builds on the previous.**

1. **Schema follow-ups.** New migration:
   - Add `visibility` enum column (`'public' | 'guest_only'`) to `guidebook_house_manuals`, defaulting to `'public'` for v1 (kept for forward compatibility with v2 privacy gate — see §10.2).
   - Add `host_phone`, `armed_response_company`, `armed_response_phone`, `nearest_hospital_name`, `nearest_hospital_phone`, `nearest_hospital_address`, `nearest_hospital_lat`, `nearest_hospital_lng`, `checkout_time`, `checkout_checklist jsonb` to `guidebooks`. **Do NOT add `backup_host_*` columns** (see §10.8 — deferred to v2).
   - Add `image_url` and `emergency_tag` to `guidebook_house_manuals`.
   - Normalise existing category strings in seed to match the fixed 8-category enum.
   - Replace any real credentials in the seed (WiFi password, alarm password) with placeholder values, since the URL is effectively public in v1 (see §10.2).
2. **Admin editor scaffold.**
   - Add a `Guidebooks` link to the sidebar.
   - List view at `/guidebooks` (table with search).
   - Detail editor shell at `/guidebooks/:id` with the left section nav and a stub form panel.
   - Wire Save / Publish / Preview buttons (Save persists; Publish toggles `is_published`; Preview opens `/g/:slug` in a new tab).
   - Install TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`) for long-form prose fields (welcome message, house-manual card bodies).
3. **Guest Home + quick-actions strip.**
   - Refine the existing `GuidebookPage.tsx` hero.
   - Build the quick-actions strip component.
   - Build the host card with Call + WhatsApp buttons.
4. **Arrival + WiFi + Emergency page (critical path).**
   - Wire one-tap copy on the WiFi card with toast.
   - Build the Directions card with the embedded Mapbox GL JS map + Google Maps deep-link CTA + `<details>` for the prose (see §10.1).
   - Build the Emergency page at `/g/:slug/emergency` and the FAB that opens it from any page. Hardcode SA emergency numbers (`10111`, `10177`, `+27 86 12 12 300`) — no `country_code` lookup (§10.10).
   - Persistent host-contact chip.
5. **House manual grouping + photos.**
   - Group cards by the fixed 8-category taxonomy.
   - Add the photo-first card variant (uses the new `image_url` column).
   - Build the `<details>` expand-on-mobile interaction.
   - Admin editor: enforce the category enum, allow photo upload.
   - **Skip the privacy unlock UX (§4.10) — visibility column exists but UI renders every card.** (§10.2)
6. **Recommendations: chips + Mapbox view + tap-to-navigate.**
   - Add the category chip row + filter logic.
   - Add the List / Map view toggle.
   - Integrate Mapbox GL JS (§10.1).
   - Wire Google Maps deep-links on every address.
7. **Global search (Cmd+K).**
   - Build the search index on guidebook load.
   - Build the search modal using the `ActionModal` shell.
   - Wire keyboard shortcuts.
   - Add the search pill to the sticky nav.
   - **No analytics logging in v1** (§10.4).
8. **Departure checklist.**
   - Schema fields + admin editor for the checklist items.
   - Guest renderer with checkbox + progress bar + localStorage persistence.
9. **PWA / offline support.** (§10.5 — promoted into v1.)
   - Add `vite-plugin-pwa` with a Workbox precache + runtime cache config.
   - Cache the guidebook JSON payload + photo URLs on first open.
   - Manifest: name "Montrose Terrace", short_name, theme color `#0F4C75`, 192/512 icons, `display: standalone`, `start_url: /g/:slug`.
   - Add "Available offline" badge to the guest header once the SW is `active`.
   - Show a small "Update available — tap to refresh" toast on SW update.
   - Test: load on mobile, enable airplane mode, reload — full guidebook still works.
10. **Polish.**
    - Skeleton loading states.
    - DOMPurify on all TipTap-produced HTML.
    - `noindex` meta + `robots.txt`.
    - Reduced-motion fallbacks.
    - Lighthouse pass — target ≥95 on all four metrics for `/g/montrose-terrace`, including PWA installability.

---

## 9. Out of Scope (v1)

These ideas surfaced in the teardown and are tempting. **Defer them.** They are not v1 work.

- **AI itinerary generator.** Hostfully has the toggle off too. Defer to v2.
- **AI Q&A grounded in guidebook content.** Great idea, defer.
- **Voice / read-aloud of the guidebook.** Defer.
- **Sponsored recommendations.** Defer (monetisation play, not relevant in v1).
- **Multi-language.** v1 ships English only; the schema is non-i18n. Defer.
- **Marketplace / "Book Again".** Defer.
- **Splash screen with email collection.** Anti-pattern (§7.13). Do not ship.
- **Pre-arrival staged email comms.** Cross-system work (email infra). Defer.
- **Privacy unlock UX (stay-code modal, magic links, `?stay_code=` handling).** Deferred to v2 per §10.2 — the `visibility` column stays in the schema, but the guest UI renders every card. Seed must use placeholder credentials.
- **Backup host fields and UI.** Per §10.8 — single `host_name` only.
- **Property-owner RLS in the admin editor.** Per §10.6 — all authenticated users have full CRUD.
- **Separate guest subdomain.** Per §10.7 — guest route lives at `/g/:slug` on the admin portal domain.
- **Multi-country / `country_code`-driven emergency content.** Per §10.10 — SA hardcoded.
- **Host-side analytics (search query logs, card-open counters).** Per §10.4 — v2.
- **House map / floor plan.** Strong-have; defer to v1.1 unless trivial photo upload counts.
- **House-rules acknowledgement checkbox + guest paper trail.** Defer.
- **Guest-facing search analytics for hosts.** v2 telemetry feature.
- **"Report an issue" channel.** Defer.
- **Eskom Se Push live load-shedding integration.** Manual content for v1.
- **Print-to-PDF.** Defer; the brochure already has print styles for a different surface.
- **QR code generator for the guidebook URL.** Trivial — could squeeze into v1 polish if time.

---

## 10. Decisions (answers to original open questions)

All ten questions have been resolved by the user. **These are now binding decisions for v1 — do not relitigate.**

1. **Map provider — DECIDED: Mapbox GL JS for the rendered map; Google Maps deep-links for tap-to-navigate.** Works regardless of provider.
2. **Privacy unlock UX — DEFERRED to v2.** For v1, treat all guidebook content as effectively public (no auth gate). Do *not* publish real credentials in the seed — use placeholder values for the WiFi password, alarm password, etc. The privacy-tier column (`visibility: public | guest_only`) should still exist in the schema so v2 can flip the switch, but the runtime can ignore it for now.
3. **Per-field privacy granularity — DECIDED: whole-card only.** No per-field privacy. Card-level `visibility` enum is enough.
4. **Host-side analytics — DEFERRED to v2.** Do not instrument search queries / card opens in v1.
5. **PWA / offline support — DECIDED: yes, ship in v1.** Service worker caches the guidebook payload + photos on first open. "Available offline" badge. Promote from out-of-scope (§9) into the implementation order (§8) — see updated §8.
6. **Admin editor permissions — DECIDED: all authenticated users get full CRUD for v1.** No owner-scoped RLS. User is iterating locally; multi-tenant gating is a v2 concern.
7. **Domain / subdomain — DEFERRED to v2.** v1 lives on the admin portal's domain: guest route is `/g/:slug` on the same host. No subdomain split, no separate Vite app.
8. **Backup host — DEFERRED to v2.** Schema's single `host_name` / `host_phone` / `host_email` is enough for v1. Do *not* add `backup_host_*` columns yet.
9. **Rich-text editor — DECIDED: TipTap.** Install `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`. Use it for the long-form prose fields on House Manual cards and the welcome message.
10. **Country-specific emergency numbers — DECIDED: hardcode South Africa.** No `country_code` lookup, no JSON dictionary. Single SA-localised emergency page.

### Concrete v1 impact of these decisions

- **PWA work is IN v1.** §9 (Out of Scope) is amended to remove "PWA / offline" — it now belongs in §8 as PR #9 (between Departure polish and final QA).
- **Privacy gate UI is OUT of v1.** Skip the unlock modal (§4.10) and any `?stay_code=` handling. The `visibility` column stays in the schema for forward compatibility, but the guest UI renders all cards. Continue to seed placeholder credentials, not real ones, because the URL is effectively public.
- **TipTap is the canonical editor.** Don't roll a textarea + Markdown shim.
- **No backup-host fields.** If the Montrose seed has Nicki, render her inside the welcome-message prose, not as a structured field.
- **All emergency content is SA-specific** — `10111` (police), `10177` (ambulance), `+27 86 12 12 300` (national), no internationalisation layer.

---

## Appendix A: File map for the next session

Files the next session will need to touch (absolute paths):

- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/pages/GuidebookPage.tsx` — extend, do not rewrite.
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/app.css` — add the `gb-*` styles described in §3 and §4 (search `gb-` to find the existing block; extend it).
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/App.tsx` — wire the new routes (`/guidebooks`, `/guidebooks/:id`, `/g/:slug/emergency`).
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/components/GlobalSearchModal.tsx` — reference pattern for the guest-side search modal (do not modify; build a sibling `GuidebookSearchModal.tsx`).
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/index.html` — add Pacifico if missing; add `<meta name="robots" content="noindex">` conditionally for guest routes (or use react-helmet).
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/supabase/migrations/` — new migrations per step 1 of §8. Follow the existing `20260526*` numbering convention; the next migration should be `20260527*`.
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/supabase/functions/` — new Edge Function `guidebook-fetch-private` for token-gated reads (create the directory if it doesn't exist).
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/lib/guidebookTaxonomy.ts` — new module, single source for the category enum.
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/src/lib/guidebookSearch.ts` — new module, builds + queries the Fuse.js index.
- `/Users/jordonharrod/Desktop/ct-rentals-handover/admin-portal/docs/DESIGN-SYSTEM.md` — existing design doc; cross-reference but don't duplicate (this guidebook guide IS the canonical reference for the guidebook feature).

---

## Appendix B: Design tokens as a single drop-in CSS block

Paste this near the top of `src/app.css` (under the existing `:root` block — or as an additional block if `:root` is already crowded):

```css
:root {
  /* Guest-surface (guidebook) tokens — see GUIDEBOOK_DESIGN_GUIDE.md §3.1 */
  --gb-cream:   #FBF8F2;
  --gb-linen:   #F4EFE6;
  --gb-paper:   #FFFFFF;
  --gb-ink:     #1a1a1a;
  --gb-gold:    #d4af37;
  --gb-grey:    #6D6D6D;

  /* Guest-surface type — used by guidebook only */
  --gb-font-display: 'Playfair Display', 'Times New Roman', serif;
  --gb-font-script:  'Pacifico', 'Yellowtail', cursive;
  --gb-font-sans:    'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --gb-font-bold:    'Montserrat', 'Inter', sans-serif;
  --gb-font-mono:    ui-monospace, 'SF Mono', Menlo, monospace;

  /* Emergency-surface tokens */
  --gb-emerg-bg:   #FEF2F2;
  --gb-emerg-fg:   #DC2626;
  --gb-emerg-fg-2: #B91C1C;
}
```

---

## Appendix C: Reusable snippets for the next session

### Tap-to-call link

```tsx
function TelLink({ number, label }: { number: string; label: string }) {
  // Pass the number with country code, e.g. "+27834157779"
  return (
    <a className="btn-tel" href={`tel:${number}`} aria-label={`Call ${label}`}>
      <Icon name="phone" /> <span>{label}</span>
    </a>
  );
}
```

### WhatsApp deep-link

```tsx
function WhatsAppLink({ number, label }: { number: string; label: string }) {
  // wa.me wants no leading +, no spaces
  const wa = number.replace(/[^\d]/g, '');
  return (
    <a
      className="btn-whatsapp"
      href={`https://wa.me/${wa}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Message ${label} on WhatsApp`}
    >
      <Icon name="message" /> <span>WhatsApp {label}</span>
    </a>
  );
}
```

### Open-in-Maps link

```tsx
function MapsLink({ address, label }: { address: string; label?: string }) {
  const q = encodeURIComponent(address);
  return (
    <a
      className="btn-outline-primary"
      href={`https://www.google.com/maps/search/?api=1&query=${q}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label || 'location'} in Maps`}
    >
      <Icon name="map" /> <span>Open in Maps</span>
    </a>
  );
}
```

### Copy-to-clipboard button

```tsx
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn-copy ${copied ? 'is-copied' : ''}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1800);
      }}
      aria-label={`Copy ${label}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
```

### Sanitised HTML renderer

```tsx
import DOMPurify from 'isomorphic-dompurify';

function SafeHTML({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','strong','em','ul','ol','li','a','br','h3','h4','blockquote'],
    ALLOWED_ATTR: ['href','rel','target'],
  }), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

---

**End of guide.** Build steps 1–10 in order. Confirm §10 answers with the user before starting step 1.
