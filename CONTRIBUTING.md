# Contributing to VibeStack

Thanks for taking the time to contribute to VibeStack Community Edition.

## License

VibeStack Community Edition is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).

By submitting an issue, pull request, patch, or other contribution to this repository, you agree that your contribution is provided under `AGPL-3.0-or-later` unless a separate written agreement says otherwise.

## Contributor License Agreement

To keep future commercial licensing and hosted-service options possible, substantial code contributions may require a signed contributor license agreement. The current CLA text is in [CLA.md](CLA.md).

The CLA does not transfer copyright ownership. It gives the project maintainer permission to use, distribute, and relicense accepted contributions, including as part of commercial VibeStack offerings.

## Developer Certificate of Origin

Contributors should sign off commits using the Developer Certificate of Origin in [DCO.md](DCO.md):

```bash
git commit -s
```

The sign-off means you certify that you have the right to submit the contribution under the project license and contribution terms.

## Pull Requests

- Branch from an up-to-date `main` branch.
- Open pull requests against `main` for normal features, fixes, documentation, and dependency updates.
- Keep pull requests focused and easy to review.
- Do not commit secrets, private planning notes, local environment files, or customer data.
- Include tests or validation notes when the change affects behavior.
- Update documentation when the change affects setup, deployment, licensing, or user-visible behavior.
- Do not open ordinary contribution pull requests against `stable`, `beta`, or `nightly`. Those branches are release channels and are moved by maintainers during release publication.

## Versioning And Release Channels

VibeStack separates development commits from installable releases:

- `main` is the integration branch for reviewed work.
- `stable` is the default production update channel.
- `beta` is the prerelease channel for broader testing.
- `nightly` is the development snapshot channel.

Installed VibeStack servers compare the product release value, `vibestackRelease`, on version-tracked channels such as `stable` and `beta`. A documentation-only merge to `main` should not make production installations update.

Release changes must update the root package version and workspace package versions together. Maintainers move release-channel branches or create tags only as part of an intentional release publication.
