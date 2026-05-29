# Changelog

Crewmodo uses GitHub Releases as the production changelog source. Keep this file for draft release notes while work is still being prepared.

## Unreleased

### Added
- Production and staging Cloudflare deployment model.
- Dedicated staging and production GitHub Actions workflows.
- Crewmodo production domains and API URL fallback logic.

### Changed
- Demo deployment is manual so `main` can promote to staging without publishing every change as a public demo.

### Operations
- Production deploys should happen from a GitHub Release or manual production workflow dispatch.
- Rollbacks should use Cloudflare Pages deployment rollback and Worker version rollback.
