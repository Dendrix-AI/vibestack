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
- Release-channel branches are protected. Only an authorized maintainer should move `stable`, `beta`, or `nightly`; do not try to bypass branch protection.
- Database migrations are append-only once they have shipped on a public channel. Do not rename, remove, or rewrite a migration that may already have been applied by a user.
- Channel-switching must remain schema-safe. If a change adds migrations, preserve the compatibility checks and downgrade guard, update docs, and recommend a backup before users move across channels.

## Release Work

- When asked to release to any version-tracked channel, such as `stable` or `beta`, create a release-prep branch such as `codex/release-0.2b`, bump `vibestackRelease`, the root package version, and all workspace package versions together, then open a pull request against `main`.
- When asked for a versioned `nightly` release, still create a release-prep branch and pull request against `main`; after merge and explicit publication confirmation, move `nightly` to the merged commit.
- Do not move version-tracked channels before the release pull request is merged.
- Release pull requests must include the intended version, target channel, concise change summary, and validation commands that were run.
- After a release PR is merged, publish the requested channel only when release publication is explicitly confirmed. Publishing means moving the channel branch to the merged release commit and, when requested, creating the release tag.
- When asked to publish or release any revision-tracked channel, such as `nightly`, do not bump `vibestackRelease` unless the user explicitly asks for a versioned release. Move the requested channel to the requested commit or to current `main` after confirming the target commit.
- When asked to promote one channel to another, for example `nightly` to `beta` or `beta` to `stable`, verify both branch heads and move the target channel branch to the exact source channel commit. Do not create a merge commit between channel branches.
- Because channel branches are protected against force pushes, publish and promote channels by fast-forwarding them to commits that descend from the current channel head. If a rollback or non-fast-forward move is required, stop and ask the maintainer to explicitly approve the temporary branch-protection change and rollback target.
- If the user names an unrecognized channel such as `testing`, first check whether `origin/<channel>` exists and whether docs identify it as version-tracked or revision-tracked. If it does not exist or its tracking policy is unclear, ask whether they mean an existing channel or want a new version-tracked or revision-tracked channel.
- Never move `stable`, `beta`, or `nightly` as part of an ordinary feature PR.
