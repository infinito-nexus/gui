# 015 - Image Build from Local Source Directory

## User Story

As a developer, I want to point the deployer at a local Infinito.Nexus source directory and have it build the job-runner image automatically using that directory's own `make build` target so that I never need to maintain a separate `./infinito-nexus` checkout inside the deployer repository and there is no manual `cp` or bind-mount of source files into job containers.

## Background

The current local development mode mounts `./infinito-nexus` as a bind volume into the API and job-runner containers and then copies the source into the job container at runtime with `cp -a`. This couples the deployer repository structure to the presence of a checked-out sibling directory and requires runtime file copying.

The target architecture removes this coupling entirely: a source directory is provided once at build time, the Infinito.Nexus image is built from it using `make build-missing` (or an equivalent target) with the correct `INFINITO_DISTRO` and `IMAGE_TAG` parameters, and from that point forward only the resulting image is used — no source mount, no runtime copy.

## Scope

This requirement supersedes the local-checkout source strategy described in [014-e2e-dashboard-deploy.md](014-e2e-dashboard-deploy.md) (sections "Local development" and "Source and Image Strategy"). REQ-014 acceptance criteria that reference the `./infinito-nexus` checkout MUST be re-evaluated against this new strategy once REQ-015 is implemented.

## Build Contract

- The deployer MUST accept a source directory path as input (e.g. via a CLI argument, environment variable `INFINITO_NEXUS_SRC_DIR`, or Makefile parameter).
- The deployer MUST resolve the path to an absolute path before use.
- The deployer MUST fail fast with a clear error message when the source directory is missing or empty.
- The deployer MUST invoke `make build-missing` inside the source directory with at minimum the following environment variables set:
  - `INFINITO_DISTRO` — the target distro (default: `debian`)
  - `IMAGE_TAG` — the resolved local image tag, obtained by calling `bash scripts/meta/resolve/image/local.sh` inside the source directory with `INFINITO_DISTRO` set
- The deployer MUST use the resolved `IMAGE_TAG` value as `JOB_RUNNER_IMAGE` and `INFINITO_NEXUS_IMAGE` for the stack that follows the build step.
- The deployer MUST NOT mount the source directory into any running container after the image has been built.
- The deployer MUST NOT copy source files into job containers at runtime.

## CI Contract

- CI execution MUST NOT depend on a local source directory.
- CI execution MUST use the image referenced by `INFINITO_NEXUS_IMAGE` directly, without a build step.
- The distinction between local-build mode and CI-image mode MUST be controlled by the presence or absence of `INFINITO_NEXUS_SRC_DIR` (or equivalent parameter), not by a separate `MODE` flag.

## Entry Points

- `make e2e-dashboard-local INFINITO_NEXUS_SRC_DIR=<path>` — builds the image from the given source directory, then runs the full E2E stack and Playwright suite.
- `make e2e-dashboard-ci` — skips the build step and uses the configured registry image directly.
- Both entry points MUST be documented and wired into CI as they are today.

## Acceptance Criteria

### Build

- [x] Passing `INFINITO_NEXUS_SRC_DIR=<path>` (or equivalent) triggers a local image build using `make build-missing` inside that directory.
- [x] `INFINITO_DISTRO` and `IMAGE_TAG` are set correctly when invoking `make build-missing`.
- [x] `IMAGE_TAG` is resolved by calling `bash scripts/meta/resolve/image/local.sh` inside the source directory with `INFINITO_DISTRO` set.
- [x] The resolved image tag is used as both `JOB_RUNNER_IMAGE` and `INFINITO_NEXUS_IMAGE` for the deployer stack.
- [x] The build step fails fast with a clear error when the source directory is missing or empty.

### Runtime Isolation

- [x] No source directory is mounted into the API container, job-runner container, or any other deployer service after the build step completes.
- [x] No `cp -a` or equivalent source copy occurs inside job containers at runtime.
- [x] `JOB_RUNNER_REPO_HOST_PATH` is empty or unset in the generated env file when using the image-build path.
- [x] `INFINITO_REPO_MOUNT_TYPE` remains `volume` (not `bind`) when using the image-build path.

### CI

- [x] CI execution uses `INFINITO_NEXUS_IMAGE` without a build step and without `INFINITO_NEXUS_SRC_DIR`.
- [x] No manual environment mutation is required for CI.

### Backward Compatibility

- [x] `make e2e-dashboard-ci` continues to work without a local source directory.
- [x] The repository no longer requires or documents a `./infinito-nexus` symlink or checkout in the deployer root.

### Quality

- [x] All modified or newly written code conforms to the project coding rules.
- [x] No lint errors, type errors, or test failures remain in the affected code paths.
