#!/bin/bash
set -euo pipefail
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  exec sudo -n /usr/local/sbin/kimia-deploy "${BASH_REMATCH[1]}"
fi
echo 'Only deploy followed by a full lowercase commit SHA is permitted.' >&2
exit 2
