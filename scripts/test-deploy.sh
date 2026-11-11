#!/bin/bash
# No SSH, production database, systemd, or real /opt writes.
set -euo pipefail
cd "$(dirname "$0")/.."
for script in deploy/ci/*.sh scripts/test-deploy.sh; do bash -n "$script"; done
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
export DEPLOY_TEST_TEMP=$temp
root=$PWD

# Reject malformed commands before any privileged operation or network access.
for bad in '' main '../etc/passwd' 'abc;id' "$(printf 'a%.0s' {1..41})"; do
  if bash deploy/ci/deploy-release.sh "$bad" >/dev/null 2>&1; then exit 1; fi
  if bash deploy/ci/build-release.sh "$bad" >/dev/null 2>&1; then exit 1; fi
done
mkdir "$temp/bin"
cat > "$temp/bin/sudo" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "$DEPLOY_TEST_TEMP/ssh-arguments"
EOF
chmod +x "$temp/bin/sudo"
sha=$(printf 'a%.0s' {1..40})
PATH="$temp/bin:$PATH" SSH_ORIGINAL_COMMAND="deploy $sha" bash deploy/ci/ssh-command.sh
printf '%s\n' '-n' '/usr/local/sbin/kimia-deploy' "$sha" > "$temp/expected"
cmp "$temp/expected" "$temp/ssh-arguments"
for bad in 'bash' "deploy $sha extra" "deploy $sha; id" "deploy ../main"; do
  if PATH="$temp/bin:$PATH" SSH_ORIGINAL_COMMAND="$bad" bash deploy/ci/ssh-command.sh >/dev/null 2>&1; then exit 1; fi
done

source "$root/deploy/ci/deploy-release.sh"
curl() { printf '%s' "$health_body"; return "${curl_status:-0}"; }
health_body='{"ok":true,"database_ready":true,"booking_enabled":false,"customer_auth_enabled":false}'
health_ready http://test
for health_body in '{}' 'invalid' '{"ok":true,"database_ready":false}' '{"ok":true,"database_ready":true,"booking_enabled":true,"customer_auth_enabled":false}'; do
  if health_ready http://test; then echo 'Invalid health was accepted'; exit 1; fi
done
curl_status=7
if health_ready http://test; then exit 1; fi
unset curl_status

# Exercise the actual activation/rollback function with filesystem/service doubles.
ln() { printf '%s\n' "$2" > "$temp/$(basename "$3")"; }
readlink() { cat "$1"; }
mv() { command mv -Tf "$temp/$(basename "$2")" "$temp/$(basename "$3")"; }
systemctl() { printf '%s\n' "$*" >> "$temp/service-calls"; return "${restart_status:-0}"; }
wait_for_health() { return "${local_health_status:-0}"; }
health_ready() { return "${public_health_status:-0}"; }
printf '%s\n' /opt/kimia/releases/old > "$temp/current"
activate_release /opt/kimia/releases/new /opt/kimia/releases/old
[[ $(readlink "$temp/current") == /opt/kimia/releases/new ]]
for failure in local public restart; do
  local_health_status=0 public_health_status=0 restart_status=0
  case "$failure" in
    local) local_health_status=1 ;;
    public) public_health_status=1 ;;
    restart) restart_status=1 ;;
  esac
  if activate_release /opt/kimia/releases/bad /opt/kimia/releases/old; then
    echo "Failure did not trigger rollback: $failure"; exit 1
  fi
  [[ $(readlink "$temp/current") == /opt/kimia/releases/old ]]
done
echo 'Deployment checks passed: shell syntax, command restrictions, health JSON, activation, and rollback on restart/local/public failure.'
