# Kimia repository consolidation — 2026-11-11

## Canonical repository

https://github.com/amirfassadi/KimiaBeautySalon

All future frontend, backend and documentation changes belong here. This consolidation does not delete another repository, change the live Site's audience, move runtime secrets, or modify production customer data.

## Sources

| Source | Captured revision | Disposition |
| --- | --- | --- |
| KimiaBeautySalon main | 8a315a6c961fcf6b2bc2024230105cde0234552b | Retained as a parent of the consolidation commit |
| KimiaBeautySalon implementation | 9fa4f76499e792dbcad33d32cc47be2d92bab141 | Retained as an additional parent; code is the live implementation baseline |
| Sites publication 5 | 28f4d142d65d11f160578bad465d27a4850997e2 | Source opened through Sites; current source, assets and deployment manifest retained |
| KimiaBeauty main | 972bcc89b2ae7d8d46e256c5b3e117c48c1ab66c | Preserved in history bundle |
| KimiaBeauty public-site branch | eb876bbfe4656dff3a22d1452a58cece71d662f8 | Full file snapshot in archive/KimiaBeauty; history bundle includes all fetched refs |
| Repaired local AI Studio export | Local recovery in this chat | Vite preview adapter, TypeScript configuration, lockfile and recovery notes retained |

The Site source and GitHub implementation contain the same application in the compared src/, worker/ and db/ files apart from trailing newline/line-ending differences. The Site's source is used for the active application. Bundles preserve original Git objects, rather than pretending unrelated histories are already integrated into one application.

## What was preserved

- Persian public website, atelier content, service pages, image assets, administrator UI and Worker source.
- Three PostgreSQL migrations, existing automated checks and Sites identity/configuration.
- All files from the legacy public-site branch, including its Persian/English example and complete SmartCore product/architecture roadmaps.
- Original Git histories in archive/history/*.bundle, including the managed Site history.
- Legacy issue/PR metadata in archive/KimiaBeauty-GitHub-discussions.json. The old repository had one PR and no separate issues in the retrieved listing, with no retrieved issue or review comments.

Generated dist files and secrets are intentionally excluded from active source. Production database records, uploaded R2 files and runtime secrets stay in their existing services; no backup or migration of those runtime stores is claimed.

## Architecture decision for this consolidation

The running salon application remains the operational baseline. Legacy SmartCore ownership documents remain historical design intent; no new integration or duplicate backend is introduced. PostgreSQL remains required. Authentication portability, configurable public origin and synchronizing form time choices with administrator-edited business hours remain follow-up backend tasks.

## Restore old Git histories

From a clone of this repository, these bundles can be verified with:

```bash
git bundle verify archive/history/KimiaBeauty-history.bundle
git bundle verify archive/history/KimiaBeauty-Sites-history.bundle
```

To inspect the former repository independently, clone its bundle into a new empty directory:

```bash
git clone archive/history/KimiaBeauty-history.bundle ../KimiaBeauty-history-review
```

The old GitHub repository can be retired after the consolidation commit, file presence and bundle verification are confirmed. Keep the live Site: it is a deployment, not a redundant GitHub repository. Sites' internal source repository remains platform-managed and must not be deleted.

## Validation scope

Run clean dependency installation, production Worker build, existing automated tests, TypeScript checks, bundle verification and local preview HTTP checks. This does not certify real Supabase/VPS connectivity, production sign-in, browser appearance, or a new deployment. No production deployment is necessary for this source-only consolidation.
