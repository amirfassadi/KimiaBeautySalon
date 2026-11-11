#!/bin/bash
set -euo pipefail
umask 027

[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ $(id -un) == kimia-deploy ]] || exit 2
revision=$1
cd /var/lib/kimia-deploy/repository
git fetch --no-tags origin main
[[ $(git rev-parse origin/main) == "$revision" ]] || {
  echo 'Revision is no longer the head of main; refusing stale deployment.' >&2
  exit 1
}
git checkout --detach --force "$revision"
git clean -ffdqx
npm ci
npm run build
npm test
npm run lint
test -s dist/server/index.js
