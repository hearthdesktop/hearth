# Releasing Hearth

Releases are cut from the `release` branch. Every push to it builds and publishes the version in `package.json`.

1. On `main`, bump `version` in `package.json` through a pull request and merge it.
2. Fast-forward `release` to `main`: `git push origin main:release`.
3. The Release workflow then:
    - tags `vX.Y.Z` and builds Linux, Windows and macOS,
    - publishes the GitHub release with the AppImage, deb, rpm, tar.gz, Windows and macOS builds,
    - pushes the new PKGBUILD to the `hearth-bin` AUR package,
    - submits a build to COPR.

A version that already has a tag is refused, so a release can't be overwritten by accident.

The Nix flake builds from source and needs nothing per release: `nix run github:hearthdesktop/hearth/vX.Y.Z` works as
soon as the tag exists. Only a `pnpm-lock.yaml` change needs attention, since `pnpmDeps.hash` in
`packaging/nix/package.nix` has to be updated; the nix workflow fails and prints the new hash when it drifts.

## One-time setup

Repository secrets and variables (Settings → Secrets and variables → Actions):

| Name | Kind | What it is |
| --- | --- | --- |
| `AUR_SSH_PRIVATE_KEY` | secret | Private SSH key whose public half is added to the AUR account that owns `hearth-bin` |
| `COPR_CONFIG` | secret | The contents of the API config from https://copr.fedorainfracloud.org/api/ |
| `COPR_PROJECT` | variable | The COPR project to build in, as `owner/hearth` |
| `APPLE_SIGNING_CERT`, `APPLE_SIGNING_CERT_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | secrets | Optional. Without them the macOS build is unsigned and not notarized |

The AUR and COPR steps are skipped with a warning while their secrets are missing, so a release still goes out.

The COPR project has to exist before the first build, with the Fedora chroots you want enabled for x86_64 and aarch64.
