# Changelog

Notable user-facing changes to VibeStack are documented here. Release names follow the
`vibestackRelease` value in the root `package.json`; package versions stay aligned across
the workspace packages for each release.

## 0.2d - 2026-05-11

### Added

- Added VibeStack Doctor, including API and web UI support for collecting app state,
  deployment events, runtime logs, health-check results, and generated troubleshooting
  guidance.
- Added Doctor support to the `deploy-to-vibestack` skill, including helper commands
  and reference documentation for troubleshooting failed deployments.
- Added cached Doctor OpenRouter results so repeated checks can reuse recent analysis.
- Added Doctor awareness of current server and application state for more precise
  troubleshooting output.

### Changed

- Rebranded the external app password gateway page and corrected the Dendrix website link.
- Documented protected release-channel branches and maintainer-only release publishing
  expectations.

### Fixed

- Fixed Doctor helper command dispatch in the deployment skill.
- Fixed Fastify 5 dependency compatibility and migration locking behavior.
- Fixed system backup command execution when running inside Docker.

## 0.2c - 2026-04-30

### Added

- Added system backup download and restore support from Settings, including database and
  configuration backup archives.
- Added schema compatibility checks before applying platform updates so channel changes
  that would downgrade the database schema are blocked.
- Added backup recommendations when the target update includes pending database migrations.
- Documented channel promotion rules, migration safety, and backup guidance for release
  operations.

### Fixed

- Improved update-channel safety for `stable`, `beta`, `nightly`, and `main` by validating
  the target branch before update execution.

## 0.2b - 2026-04-30

### Added

- Added release update channels so installed servers can track `stable`, `beta`, `nightly`,
  or `main` according to the channel's tracking policy.
- Added UI handling for unavailable update channels.
- Added admin, install, creator onboarding, first-app deployment, and operations
  documentation.
- Added contributor licensing documentation, including CLA, DCO, and contribution guidance.
- Added CI smoke coverage for the full stack.

### Changed

- Rebranded the project for Dendrix AI and moved the Community Edition licensing to AGPL.
- Updated Vite and Vitest development dependencies.
- Improved deployment lifecycle feedback, update status refresh behavior, and selected app
  detail refresh behavior in the web UI.
- Improved the deployment health preflight and deployment failure guidance surfaced to
  agents and users.

### Fixed

- Fixed external app password gateway support and self-update feedback.
- Fixed app update deployments and active app uniqueness handling.
- Fixed app diagnostics exposure for deployed applications.
- Hardened deployment source validation to reject unsafe or malformed deployment inputs.
- Improved deployment health preflight checks and failure diagnostics.

## 0.1a - 2026-04-28

### Added

- Initial public VibeStack release with the API service, worker, web app, shared package,
  Docker Compose runtime, install script, deployment skill, sample app fixtures, and local
  smoke verification.
- Added app deployment, app lifecycle management, authentication, authorization, audit logs,
  Cloudflare integration, runtime cleanup, and deployment validation.
- Added UI-driven platform updates.
- Added reusable app creator onboarding documentation and deployment defaults.

### Fixed

- Required Cloudflare install settings and provisioned install DNS records during setup.
- Continued installation after DNS provisioning and updated the Traefik v3 image.
- Made first-admin bootstrap idempotent.
- Shared auth cookies across app subdomains and cleared the legacy host session cookie.
- Improved audit log actor and source IP handling.
