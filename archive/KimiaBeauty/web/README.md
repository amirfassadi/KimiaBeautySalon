# Kimia public website foundation

Dependency-free, responsive Persian/English public site. Run `node web/server.mjs` from the repository root, then open `http://localhost:4173`. Deploy the contents of `web/` on any static host (the preview server itself is for local use).

Edit `web/content/site.json` to supply verified salon data. Keep `serviceCatalog` empty until services and prices are approved. A published service has `active: true`, `public: true`, localized `category`, `name`, `description`, `durationMinutes`, and optionally `price: { "amount": 100000, "currency": "IRR" }`. Set contact details only after verification. The public site renders only provided values; it does not offer booking or login until real SmartCore integrations exist.

This JSON is a temporary content source for the manually launched Kimia site. Later replace the loader with public Business and Service Catalog APIs; keep Identity, Business and Service as the respective sources of truth. The same fields can then be entered through an owner onboarding flow.
