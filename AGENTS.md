# Agent Instructions

**For AI coding tools and human contributors working on this repo.**

Before changing any UI (page, modal, list, form, button), read
`docs/DESIGN-SYSTEM.md`. It is the source of truth for the patterns
this codebase has converged on.

## The short rules

- **Modals:** use `<DetailModal>` (`src/components/DetailModal.tsx`) for view/edit, or `<ActionModal>` (`src/components/ActionModal.tsx`) for one-shot actions. Don't roll your own.
- **List toolbars:** filters → search → count → `+ New X`. No refresh buttons.
- **Status pills:** `.ops-status-pill` with a semantic variant. No hex codes inline.
- **Buttons:** outcome actions use `.btn-outline-success` / `.btn-outline-danger`. Never `style={{ color, borderColor }}` on a button.
- **Text colours:** body and labels both use `var(--text)`. CT Rentals' users include older staff with weak eyesight — never default to `var(--text-light)` for anything they need to read.
- **User-entered names** render through `titleCase()`. **Emails** render through `toLowerCase()`.

If a pattern in `docs/DESIGN-SYSTEM.md` is insufficient, update the
doc in the same PR as the change. Don't work around it inline.

## Stack

- React 18 + Vite + TypeScript (no `.js` / `.jsx`, no `any`)
- Supabase (`src/lib/supabase.ts`)
- Vercel hosting; merges to `main` auto-deploy
- npm (not pnpm); `package-lock.json` is the lockfile
- No new packages without explicit approval

## Workflow

- Branch off `main`
- Push to your fork
- Open PR against `H-Squared-Consulting/ctrentals:main`
- One logical change per commit
- `npm run build` must pass before pushing
- No `git push --force`, no schema migrations without explicit sign-off
