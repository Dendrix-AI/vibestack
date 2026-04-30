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

- When asked to release to any version-tracked channel, such as `stable` or `beta`, create a release-prep branch such as `codex/release-0.2b`, bump `vibestackRelease`, the root package version, and all workspace package versions together, then open a pull request against `main`.
- Do not move version-tracked channels before the release pull request is merged.
- Release pull requests must include the intended version, target channel, concise change summary, and validation commands that were run.
- After a release PR is merged, publish the requested channel only when release publication is explicitly confirmed. Publishing means moving the channel branch to the merged release commit and, when requested, creating the release tag.
- When asked to publish or release any revision-tracked channel, such as `nightly`, do not bump `vibestackRelease` unless the user explicitly asks for a versioned release. Move the requested channel to the requested commit or to current `main` after confirming the target commit.
- When asked to promote one channel to another, for example `nightly` to `beta` or `beta` to `stable`, verify both branch heads and move the target channel branch to the exact source channel commit. Do not create a merge commit between channel branches.
- If the user names an unrecognized channel such as `testing`, first check whether `origin/<channel>` exists and whether docs identify it as version-tracked or revision-tracked. If it does not exist or its tracking policy is unclear, ask whether they mean an existing channel or want a new version-tracked or revision-tracked channel.
- Never move `stable`, `beta`, or `nightly` as part of an ordinary feature PR.
