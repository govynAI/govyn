# Releasing Govyn

This repo ships three public release surfaces:

- GitHub release for the source tree and release artifacts
- npm package `govyn` for the proxy CLI
- PyPI package `govynai` for the Python SDK

Do not attempt to publish the proxy itself to PyPI as `govyn`. That package name already belongs to another project on PyPI. The Python release target for this repo is `govynai`.

## Versioning

Use one repo version tag for the release, formatted as `vX.Y.Z`.

Update these files together before tagging:

- `package.json`
- `package-lock.json`
- `dashboard/package.json`
- `dashboard/package-lock.json`
- `python-sdk/pyproject.toml`
- `python-sdk/govynai/__init__.py`
- Python SDK version assertions in `python-sdk/tests/`

## Preflight

Run the full release check from the repo root:

```bash
npm run release:check
```

That covers:

- root tests, lint, typecheck, build
- dashboard build
- Python SDK tests
- security scan
- Python package build

## GitHub Actions Requirements

Configure these before pushing a release tag:

- `NPM_TOKEN`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- PyPI trusted publishing for the `govynai` project, using the GitHub Actions environment named `pypi`

## Release Flow

1. Commit the release-ready tree.
2. Create an annotated tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
```

3. Push the branch and tag:

```bash
git push origin main
git push origin vX.Y.Z
```

## What the Tag Triggers

The tag pipeline will:

- rerun repo CI checks
- build and publish `govyn` to npm
- build and publish `govynai` to PyPI
- build and push the Docker image
- create a GitHub release with packaged artifacts

## Release Artifacts

The GitHub release uploads:

- npm tarball for `govyn`
- wheel and sdist for `govynai`
- packaged dashboard build
- `sha256sums.txt`

## Rollback Notes

- npm and PyPI versions are immutable once published
- if a release is bad, cut a new patch version rather than trying to overwrite the old one
- GitHub release notes can be edited after the tag is pushed, but package registries cannot be rewritten
