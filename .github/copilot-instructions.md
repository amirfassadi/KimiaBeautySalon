# KimiaBeautySalon development guidance

This is the canonical Kimia repository. Read README.md and docs/CONSOLIDATION.md first.

- Active frontend: src/index.html and src/admin.html. Active server: worker/.
- PostgreSQL is required. Keep migrations append-only once applied. The current server adapter uses Supabase/PostgREST; do not replace PostgreSQL with another database.
- Preserve booking request versus confirmed appointment semantics, consent, idempotency, throttling, transactional conflict checks, admin authorization and image publication checks.
- Never trust locally supplied Sites identity headers. Local preview deliberately runs without production credentials; do not add fake successful bookings or fake administrator login.
- Preserve the existing Sites project ID and audience unless the owner explicitly requests a hosting change. Never commit credentials, customer records, generated dist output or node_modules.
- Use npm ci, npm run build and npm test. For frontend/configuration changes also run npx tsc --noEmit and verify npm run dev.
- archive/ is historical/reference material, not another active app. Do not deploy archive/KimiaBeauty/web/ or treat archived roadmaps as implemented capabilities.
- The live implementation is currently standalone. Any future SmartCore integration must deliberately reconcile authoritative data ownership rather than create duplicate stores.
- Concept images are not actual salon/customer photographs. Preserve accurate labeling.
