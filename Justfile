# Iblis (open-source client) task runner. Every workflow goes through `just`.

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
# Windows' `bash.exe` app alias launches WSL. Use Git for Windows' `sh.exe`.
set windows-shell := ["sh", "-eu", "-c"]

default:
    @just --list

# Install workspace dependencies and the Electron binary.
install:
    @pnpm install
    @cd apps/shell && pnpm electron:install

# Helper scripts shared with the maintainers' tree refer to this name.
alias shell-install := install

# Open the Electron window with hot reload. Needs a desktop session.
dev: sdk-build
    @cd apps/shell && pnpm dev

# Bundle main + preload + renderer into apps/shell/out/.
build: sdk-build
    @cd apps/shell && pnpm build

# Unsigned Windows installer in apps/shell/release/ (run on Windows).
dist: sdk-build
    @cd apps/shell && pnpm dist

sdk-build:
    @pnpm --filter @iblis/plugin-sdk build

typecheck: sdk-build
    @pnpm --filter @iblis/plugin-sdk typecheck
    @cd apps/shell && pnpm typecheck

lint: sdk-build
    @bash scripts/scan-style-src.sh
    @pnpm --filter @iblis/plugin-sdk lint
    @cd apps/shell && pnpm lint
    @git ls-files -z '*.md' '*.ts' '*.svelte' '*.css' '*.json' '*.cjs' '*.py' | xargs -0 python3 scripts/scan-emojis.py

format:
    @cd apps/shell && pnpm format

# Unit tests in every workspace package, plus the training sidecar.
test: sdk-build
    @pnpm -r test
    @cd packages/plugins/acestep-training && python3 -m unittest discover -s tests -p 'test_*.py'

# Real Electron/Chromium check for the custom media protocol and <audio>.
media-test:
    @sh scripts/shell-media-test.sh

# Renderer E2E: Playwright over the built Electron shell (apps/shell/e2e/).
e2e: build
    @sh scripts/shell-e2e.sh

# Bundle and run the waveform analysis worker against a generated WAV.
analysis-test: build
    @sh scripts/shell-analysis-test.sh

# Bundle and run the built-in BPM/key detector worker.
processor-test: build
    @sh scripts/shell-processor-test.sh

# Build the local trainer runtime pack (large download; see tools/training-pack).
training-pack-build:
    @bash tools/training-pack/build.sh

# HTML API reference for @iblis/plugin-sdk (TypeDoc) in packages/plugin-sdk/api-docs/.
sdk-docs:
    @pnpm --filter @iblis/plugin-sdk run api-docs

# Verify a signed catalog directory (catalog.json + catalog.json.sig) against the
# public key the shell ships. Example: just catalog-verify apps/shell/e2e/fixtures
catalog-verify dir: sdk-build
    @node tools/catalog/verify-catalog.cjs --dir "{{dir}}"
