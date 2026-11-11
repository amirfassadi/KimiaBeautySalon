# Google AI Studio import recovery

The supplied export contained six files: README, package.json, tsconfig.json,
vite.config.ts, .gitignore and .env.local. It did not contain the site source,
images, Worker, migrations, or an HTML entry point. This establishes an incomplete
export/import, but does not establish the cause of Google's dependency-installation
failure; its installation log was not available.

Source restored from amirfassadi/KimiaBeautySalon branch
codex/professional-site-postgres-foundation, commit
9fa4f76499e792dbcad33d32cc47be2d92bab141.

## Local or AI Studio preview

Run `npm ci`, then `npm run dev`. The default port is 3000. The preview adapter
builds and serves the original Worker and injects Vite's reload client. Source
changes refresh the preview. `npm run build` creates the original production
Worker artifact. `npm test` runs the existing checks including PostgreSQL/WASM.

The preview does not load database secrets or trust hosting identity headers.
Booking submission stays disabled; administrator login requires the actual
hosting integration and is not simulated locally. PostgreSQL migrations and
production authentication are preserved for subsequent backend work.

If importing into AI Studio, ensure src/, worker/, scripts/, db/, docs/ and
.openai/ are present. Do not import only the README branch. Keep the package lock
with package.json. Do not publish secrets, .env.local, node_modules or dist.

The .env.local provided by the user was left untouched and is excluded from the
delivery archive. No repository push or deployment was performed.
