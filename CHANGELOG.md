# Changelog

## 0.2.0

### Fixed

- Dry run no longer touches the cluster. The action declared dry-run support but ignored it, so running a template in the template editor applied the manifest for real. Now it validates the manifest and logs what would be applied.
- `manifestFile` can no longer point outside the template workspace.
- Manifests with several documents separated by `---` are applied in order. Before, they failed to parse.

### Added

- The package default-exports a backend module, so installing is `backend.add(import('@ruivalim/kubernetes-apply'))`.
- Tests.

### Changed

- `@kubernetes/client-node` upgraded from 0.21 to 1.4, the version Backstage itself uses.
- Built against `@backstage/plugin-scaffolder-node` 0.13, now a regular dependency instead of a peer.
- The README documented the old backend system, which no longer exists. It now shows the new backend system.
- Requires Node.js 22 or 24.
