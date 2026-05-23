# CT Rentals UI Design System

The canonical reference for everything UI in this repo. Read it before
adding or changing any page, modal, list, form, or button. The goal is a
single coherent product where every screen feels like a sibling of the
last.

This document is the source of truth for the patterns. If a pattern here
is not enough, propose a change in a PR rather than working around it.

---

## Quick rules (the short version)

- **Modals:** use `<DetailModal>` (Tier A) or `<ActionModal>` (Tier B). Do not roll your own with `.modal-overlay` + `.modal`.
- **List toolbars:** order is filters → search → count → `+ New X`. No exceptions.
- **Status pills:** use `.ops-status-pill` with a semantic variant (`--sent`, `--won`, etc.). No inline hex codes.
- **Outcome buttons:** `.btn-outline-success`, `.btn-outline-danger`. Never `style={{ color: '#XXX', borderColor: '#XXX' }}`.
- **Body text:** dark, weight 500. **Labels:** dark, weight 700, uppercase, letter-spaced. CT Rentals' users include older staff with weaker eyesight — never default to light-grey for anything they need to read.
- **Names + properties** in user data: render through `titleCase()`. **Emails:** force `toLowerCase()`.

---

## Shared React components

### `<DetailModal>` — Tier A (view / edit one entity)

`src/components/DetailModal.tsx`

Use for any modal that opens a single record for viewing or editing
(Deal, Proposal, Booking, Guest, Owner). Renders the centred 880px
shell with the coloured 5px accent strip, mode-aware header, sectioned
body, and tinted footer.

```tsx
import DetailModal, { DetailModalSection } from '../components/DetailModal';

<DetailModal
  title={titleCase(form.name)}
  subtitle={<>Stage: <strong>New</strong> · 28 Mar to 29 May</>}
  accentColour="var(--info)"
  mode={mode}                // 'view' | 'edit'
  onModeChange={setMode}
  canEdit={!isClosed}        // hides Edit button when entity is terminal
  isDirty={isDirty}
  onSave={save}
  onCancel={() => { setForm(initialForm); setMode('view'); }}
  closedBadge={closedBadge}  // optional pill that replaces the mode pill
  banner={banner}            // optional banner at top of body
  footerActions={<>...</>}   // entity-specific outcome buttons
  footerHint={<>Click <strong>Edit</strong> to change fields.</>}
  onClose={onClose}
>
  <DetailModalSection heading="Client details">
    <fieldset disabled={mode === 'view'} style={{ border: 0, padding: 0, margin: 0 }}>
      {/* form fields */}
    </fieldset>
  </DetailModalSection>

  <DetailModalSection heading="Stay details">
    {/* ... */}
  </DetailModalSection>
</DetailModal>
```

**Rules:**
- Always default `mode` to `'view'`. Edit is a deliberate click. Stops phone-tap-bumps on live data.
- Wrap form fields in `<fieldset disabled={mode === 'view'}>` so view mode locks every input cleanly.
- Action buttons (Mark Booked, Mark Lost, Delete, Reopen) live in `footerActions` and stay clickable in both modes — they're outcomes, not edits.
- Dirty-check on close is built in. Set `isDirty` accurately so the prompt only fires when needed.

### `<ActionModal>` — Tier B (one-shot operations)

`src/components/ActionModal.tsx`

Use for any modal that performs a single action and doesn't view an
entity (Send Proposal, Pick Property, CSV Import, Brochure Share, New
Enquiry form, etc.). Lighter than `<DetailModal>`: no mode toggle, no
accent strip.

```tsx
import ActionModal from '../components/ActionModal';

<ActionModal
  title="Send proposal"
  subtitle={`To ${guestName}`}
  width={520}                // default 520; 560 for the PricingDashboard; 720 for 2-column forms; 900 for the legacy PricingWidget edit-mode
  summary={<>...</>}         // optional context panel at top of body
  primaryAction={<button className="btn btn-primary" onClick={submit}>Send</button>}
  secondaryActions={<button className="btn btn-ghost" onClick={() => setStep('back')}>← Back</button>}
  hideCancel                 // optional, hides the default Cancel button
  hideFooter                 // optional, suppresses the footer entirely when the body owns its actions
  onClose={onClose}
>
  {/* form / picker / wizard step */}
</ActionModal>
```

**Rules:**
- One primary action only. The click journey must be unambiguous.
- Secondary actions (Back, Cancel) live on the left of the footer; primary on the right.
- Set `hideFooter` only when the body content has its own action button (e.g. PricingModal's calculator).

### `<DataTable>` — sortable list view

`src/components/DataTable.tsx`

The list-view component. Used by Properties, Operations list views, and
should be used by any future list page.

```tsx
<DataTable
  columns={columns}
  data={rows}
  loading={loading}
  searchable={false}         // page provides its own search in the page-level toolbar
  resultsBarContent={null}   // page provides its own count
  defaultSort={{ key: 'created_at', direction: 'desc' }}
  onRowClick={(row) => open(row.entity, 'view')}
  pageSize={25}
  emptyMessage="..."
/>
```

**Rules:**
- Set `searchable={false}` and `resultsBarContent={null}` when the page already provides search + count in its own toolbar. Otherwise an empty white strip renders above the table headers.
- Every meaningful column should be `sortable: true`. The actions column is the only exception.
- Row click opens the detail modal in **view** mode.

---

## Shared CSS systems

All shared CSS lives in `src/app.css`. New page-specific CSS classes
should be avoided. Extend the shared systems instead.

### Design tokens (`:root`)

| Token | Use |
|---|---|
| `--text` (#111827) | Body data, labels, anything the user reads |
| `--text-secondary` (#4B5563) | Genuinely secondary text only (sub-labels, helper hints) |
| `--text-light` (#6B7280) | Faint metadata only |
| `--bg` (#F3F4F6) | Page background, hover row bg, tinted footers |
| `--surface` (#FFFFFF) | Cards, modals |
| `--color-primary` (#0F4C75) | Brand accent, primary buttons |
| `--info`, `--success`, `--warning`, `--error` (+ `*-bg` variants) | Semantic colours for pills and accents |

Body default weight is `500`. Labels use weight `700` uppercase
letter-spaced. Don't lighten text colours to create hierarchy — use
size, weight, case, and letter-spacing instead.

### List page toolbar (`.list-toolbar`)

The shape every list page must follow:

```jsx
<div className="card" style={{ marginBottom: 16 }}>
  <div className="list-toolbar">
    <div className="list-toolbar-left">
      <div className="view-toggle">{/* Board / List toggle, only if both views exist */}</div>
      <select className="list-filter-select">{/* Filter 1 */}</select>
      <select className="list-filter-select">{/* Filter 2 */}</select>
      <div className="list-search">
        <span className="list-search-icon">🔍</span>
        <input type="text" placeholder="Search by client, property, ref code…" />
        {search && <button className="list-search-clear" onClick={...}>✕</button>}
      </div>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
        {filtered.length} of {data.length}
      </span>
    </div>
    <div className="list-toolbar-right">
      <button className="btn btn-primary" onClick={openCreate}>+ New X</button>
    </div>
  </div>
</div>
```

**Rules:**
- Filters first, then search, then count. Always.
- `+ New X` is the only thing on the right. No refresh button (Vite + polling handles staleness).
- Always at least 2 filter dropdowns per list page, even if placeholder, so the toolbar visually balances.

### Boards (`.ops-board-*`)

Kanban board pattern used by Enquiries and Proposals.

```jsx
<div className="ops-board">
  {STAGES.map(col => (
    <div className="ops-board-column">
      <div className="ops-board-column-header" style={{ borderTopColor: STAGE_ACCENT[col.key] }}>
        <div className="ops-board-column-header-top">
          <span className="ops-board-column-label">{col.label}</span>
          <span className="ops-board-column-count">{count}</span>
        </div>
        <div className="ops-board-column-header-bottom">
          <span className="ops-board-column-sub">{col.description}</span>
          <select className="ops-board-column-sort">{/* per-column sort */}</select>
        </div>
      </div>
      <div className="ops-board-column-body">
        {/* <DealCard /> or equivalent */}
      </div>
    </div>
  ))}
</div>
```

Columns are fixed 280px wide. The 4px top border on each column is the
semantic colour for that stage. Cards inside use `.ops-board-card`.

### List rows (`.list-*`)

Cells inside list-view tables:

- `.list-client-text` + `.list-client-name` + `.list-client-meta` for stacked client info (name on top, email/phone underneath).
- `.list-dates` + `.list-dates-arrow` for date-range cells ("5 Aug → 8 Aug").
- `.list-property` for property name with ellipsis.
- `.list-relative` for relative time ("3d ago").
- `.list-actions` + `.list-action-icon` for the row action icons. Two by default: 👁 View opens the modal in view mode, ✏️ Edit opens it in edit mode.

### Status pills (`.ops-status-pill`)

Use the semantic variant matching the stage:

```jsx
<span className={`ops-status-pill ops-status-pill--${stageKey}`}>
  <span className="ops-status-pill-dot" />
  {stageLabel}
</span>
```

Variants: `--new`, `--drafting`, `--ready`, `--sent`, `--stalled`,
`--interested`, `--won`, `--lost`, `--accepted`, `--declined`.

### Buttons

| Class | Use |
|---|---|
| `.btn.btn-primary` | Primary action (Save, Send, Create) |
| `.btn.btn-ghost` | Quiet secondary (Cancel, Back) |
| `.btn.btn-outline` | Neutral secondary action |
| `.btn.btn-outline-success` | Positive outcome (Mark Booked, Approve) |
| `.btn.btn-outline-danger` | Negative outcome (Mark Lost, Decline) |
| `.btn.btn-danger` | Destructive solid (Delete confirm) |

**Never** apply `style={{ color: '#XXX', borderColor: '#XXX' }}` to a
button. If you need a new semantic variant, add it to `app.css`.

### Forms

```jsx
<div className="form-group">
  <label className="form-label">Client name *</label>
  <input className="form-input" value={form.name} onChange={...} />
</div>
```

Labels are uppercase letter-spaced bold dark. Inputs are medium-weight
dark. Layouts inside modals use a 2-column grid:

```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
  {/* two form-groups */}
</div>
```

---

## Anti-patterns (do not do this)

- **Don't roll your own modal shell.** Use `<DetailModal>` or `<ActionModal>`. The shells own dirty-check, escape-key handling, header / footer structure, and the accent strip.
- **Don't add `.modal-overlay` + `.modal` directly to new code.** They're load-bearing legacy used by `<ActionModal>`'s overlay; don't reach past the shared component.
- **Don't use the `.page-editor` full-screen takeover** except in `PropertyEditModal`. It's the one justified case (8 tabs of content). All other detail modals use the centred `<DetailModal>` shell.
- **Don't hardcode hex colours in JSX.** Add a CSS class with a token-based colour.
- **Don't use `var(--text-light)` for anything the user has to read.** Use `var(--text)`. CT Rentals' users are older operators; legibility wins over modern subtlety.
- **Don't introduce a new page-specific CSS prefix.** Extend `.list-*`, `.ops-*`, `.detail-modal-*`, etc.
- **Don't put `Refresh` buttons in toolbars.** Pages re-fetch on entity changes via `notifyPipelineChanged()` and similar events.
- **Don't render raw user text.** Run names and property names through `titleCase()` and emails through `toLowerCase()`.

---

## Recipes

### Adding a new detail modal (Tier A)

1. Decide what fields are editable. Stay-related, contact-related — group them into sections.
2. Track form state with a snapshot (`initialForm`) and a current (`form`). Derive `isDirty` from `JSON.stringify` comparison.
3. Default mode to `'view'`.
4. Render:
   ```tsx
   <DetailModal
     title={titleCase(form.name)}
     subtitle={<>...</>}
     accentColour={accentForStatus(status)}
     mode={mode}
     onModeChange={setMode}
     canEdit={!isTerminal}
     isDirty={isDirty}
     onSave={save}
     onCancel={() => { setForm(initialForm); setMode('view'); }}
     footerActions={<>{/* outcome buttons */}</>}
     onClose={onClose}
   >
     <DetailModalSection heading="..."><fieldset disabled={mode === 'view'}>{/* fields */}</fieldset></DetailModalSection>
   </DetailModal>
   ```
5. Open from list rows: 👁 icon → `view`, ✏️ icon → `edit`. Row click → `view`.

### Adding a new list page (board + list views)

1. Page-level toolbar (see `.list-toolbar` example above): filters → search → count → `+ New X`.
2. `view: 'board' | 'list'` state. Board view uses `.ops-board`; list view uses `<DataTable>` with `searchable={false}` and `resultsBarContent={null}`.
3. Each list row: stacked client (name + email), property, dates, status pill, relative created, action icons.
4. Each board column: 280px wide, header with status-colour top border, per-column sort dropdown.
5. Row click and 👁 icon open the entity's detail modal in view mode; ✏️ icon opens in edit mode.

### Adding a new outcome button

If you need a new "Mark X" or "Approve / Reject" style button:

1. If `.btn-outline-success` / `.btn-outline-danger` fit, use them.
2. If you need a new semantic colour (e.g. "warning amber"), add a new variant to `app.css`:
   ```css
   .btn-outline-warning {
     background: transparent;
     border: 1px solid var(--warning);
     color: var(--warning);
   }
   .btn-outline-warning:hover { background: var(--warning-bg); }
   ```
3. Never use inline `style={{ color, borderColor }}` for button colours.

---

## File map

| Concern | File |
|---|---|
| Tier A modal shell | `src/components/DetailModal.tsx` |
| Tier B modal shell | `src/components/ActionModal.tsx` |
| List-view table | `src/components/DataTable.tsx` |
| All shared CSS | `src/app.css` |
| The Property editor (only `.page-editor` user) | `src/pages/PropertyEditModal.tsx` |

---

## When this document is out of date

If you find a pattern in the codebase that contradicts this document,
or if the document doesn't cover something you need to build, the
correct move is:

1. Decide which is right (the doc or the code).
2. Update the doc in the same PR, or open a separate doc PR alongside the code one.
3. Fix any code that drifted.

Drift is the enemy of consistency. Don't let it accumulate.
