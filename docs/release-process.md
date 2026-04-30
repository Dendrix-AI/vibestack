# Release Process

VibeStack separates repository integration from installable releases.

## Branch Model

- `main`: integration branch for reviewed work. Normal pull requests target `main`.
- `stable`: production update channel. Installed servers track this by default.
- `beta`: prerelease update channel for broader testing before stable.
- `nightly`: development snapshot channel for frequent testing.

Do not use release-channel branches as normal pull request targets. They should move only when maintainers intentionally publish a channel update.

## Versioning

VibeStack uses `vibestackRelease` in the root `package.json` as the product release label shown to installed servers. The regular package `version` fields remain package metadata and must stay aligned across the root package and workspace packages.

Commit hashes are build provenance. They are useful for debugging exactly what is installed, but they are not the release signal for `stable` or `beta`.

Update behavior:

- `stable` and `beta` are version-tracked. VibeStack offers an update when the branch's `vibestackRelease` changes.
- `nightly` and `main` are revision-tracked. VibeStack offers an update when the tracked branch commit changes.

## Normal Development

1. Start from current `main`.
2. Create a focused feature branch, for example `codex/update-release-channels`.
3. Make the change, update tests and docs when behavior changes, and run the relevant validation commands.
4. Open a pull request against `main`.
5. Delete the feature branch after merge.

## Release Preparation

1. Create a release-prep branch from current `main`, for example `codex/release-0.2a`.
2. Update `vibestackRelease`.
3. Update the root package version and all workspace package versions together.
4. Update release notes and any affected documentation.
5. Run validation and include the commands in the pull request.
6. Open the release pull request against `main`.

Release pull requests should state:

- intended version
- target channel, such as `beta` or `stable`
- concise change summary
- validation commands and results

## Publishing Channels

After the release pull request is merged, publish only when explicitly confirmed.

For `beta`, move the `beta` branch to the validated release commit.

For `stable`, move the `stable` branch to the release commit after the release is approved for production users.

For `nightly`, move the `nightly` branch to the desired development snapshot. This may be current `main`, but it should still be an intentional publication step.

Create or move release tags only when release publication is explicitly confirmed.
