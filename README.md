# PPL Coach

Push → Pull → Legs → Rest workout coach. Installable web app (PWA): add it to your home
screen and it runs full screen, works offline, and syncs between devices through Supabase.

## How data is kept
- Every device keeps a full copy in its own browser storage (IndexedDB). The app only reads
  and writes that copy, so it is instant and works offline.
- When you're signed in, a second copy lives in Supabase (`ppl_records`), and the two are
  matched both ways. For each record, the newest change wins.
- Row-level security (see `supabase-setup.sql`) means each user can only read and write
  their own rows.
- Settings → Download backup saves everything to a JSON file. Restore from backup merges it back.

## Files
- `index.html` – the app (UI + screens)
- `ppl-logic.js` – training rules, progress engine, storage + sync
- `support.js` – UI runtime
- `config.js` – Supabase project URL and anon key
- `sw.js` – offline cache (bump `VERSION` when files change)
- `supabase-setup.sql` – database table and security rules

## Setup
1. Create a Supabase project, run `supabase-setup.sql` in the SQL Editor, and turn off
   "Confirm email" under Authentication → Providers → Email.
2. Put the Project URL and anon public key in `config.js`.
3. Publish the folder with GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).
