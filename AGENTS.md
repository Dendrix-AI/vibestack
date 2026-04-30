# Agent Instructions

- Treat this repository as a public project. Do not commit secrets, private planning notes, implementation logs, PRDs, TRDs, or local environment files.
- Keep `main` as the integration branch. Do not commit or push directly to `main`.
- Make every code, documentation, or release-prep change on a focused feature branch and raise a pull request for review.
- Use `codex/<short-description>` for Codex-authored branches unless the user asks for a different branch name.
- Normal feature, fix, documentation, and dependency pull requests target `main`. Do not target release-channel branches for ordinary work.
- Keep pull requests focused on one reviewable change. Do not bundle unrelated fixes, private notes, or generated local artifacts.

## Versioning And Release Channels

- VibeStack has a product release value in `package.json` as `vibestackRelease`. This is the value installed servers use for version-tracked update channels.
- Keep the root package version and workspace package versions in sync when changing the VibeStack version.
- Commit hashes are build provenance only. Do not treat every `main` commit as a production release.
- `stable` is the default production update channel. It is version-tracked and should move only when a release is intentionally published.
- `beta` is a version-tracked prerelease channel for broader testing before stable.
- `nightly` is a revision-tracked test channel and may move whenever a new development snapshot is intentionally published.
- `main` is for repository integration and developer testing. It is not the default installed-user update channel.

## Release Work

- When asked to prepare a release, create a release branch such as `codex/release-0.2a`.
- Bump `vibestackRelease`, the root package version, and all workspace package versions together before opening the release pull request.
- Release pull requests must include the intended version, target channel, concise change summary, and validation commands that were run.
- After a release PR is merged, create or move release tags or channel branches only when release publication is explicitly confirmed.
- Never move `stable`, `beta`, or `nightly` as part of an ordinary feature PR.
