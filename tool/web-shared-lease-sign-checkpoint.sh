#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 1000
test "${1:-}" = --sign-checkpoint
cd "/home/alex/smartresponse/mcp/looping/.worktrees/browsing-lease-reconcile-20261127"
test "$(git rev-parse HEAD)" = 4e414cb79bb1f5c0d612ca37460e708e2cbb851a
test "$(git branch --show-current)" = integration/shared-browser-lease-20261127
key="$HOME/.ssh/id_ed25519_git_signing"
trust=/home/alex/smartresponse/mcp/console-mcp/.git/cmcp-allowed-signers
test -r "$key" && test -r "$trust"
git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$trust" verify-commit ec65887d9b685e825c5d594f7691dc5e1629052f
files=(
  playwright-worker/src/worker.js
  tool/web-visible-session-regression.mjs
  tool/web-shared-lease-drain-regression.mjs
  tool/web-shared-lease-reconciliation.ps1
  tool/web-shared-lease-sign-checkpoint.sh
)
git diff --cached --quiet
git diff --check
diff <(printf '%s\n' "${files[@]}" | LC_ALL=C sort -u) <({ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | LC_ALL=C sort -u)
git add -- "${files[@]}"
git diff --cached --check
git diff --cached --stat
git -c user.signingkey="$key" -c gpg.format=ssh -c commit.gpgsign=true commit -S -m "fix(worker): reconcile shared browser lease with upstream drain"
git log -1 --format='%H %P %s'
git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$trust" verify-commit HEAD
test -z "$(git status --porcelain)"
echo BROWSING_RECONCILED_SIGNED_CHECKPOINT_PASS
