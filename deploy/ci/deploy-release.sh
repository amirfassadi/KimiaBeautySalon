#!/bin/bash
set -euo pipefail
umask 027

health_ready() {
  local response
  response=$(curl --fail --silent --show-error --max-time 5 "$1") || return 1
  printf '%s' "$response" | node -e '
    let s=""; process.stdin.on("data", d=>s+=d); process.stdin.on("end",()=>{
      try { const d=JSON.parse(s); process.exit(d.ok===true && d.database_ready===true && d.booking_enabled===false && d.customer_auth_enabled===false ? 0 : 1); }
      catch { process.exit(1); }
    });'
}

wait_for_health() {
  local attempt
  for attempt in {1..15}; do
    if health_ready http://127.0.0.1:3018/api/health; then return 0; fi
    sleep 2
  done
  return 1
}

activate_release() {
  local target=$1 previous=$2
  # Atomic replacement on the same filesystem. Readers see either full release.
  ln -s "$target" /opt/kimia/current.next
  mv -Tf /opt/kimia/current.next /opt/kimia/current
  if systemctl restart kimia && wait_for_health && health_ready https://kbkimiabeauty.ir/api/health; then
    echo "Kimia release active: $target"
    return 0
  fi
  echo 'Health check failed; restoring previous release.' >&2
  ln -s "$previous" /opt/kimia/current.rollback
  mv -Tf /opt/kimia/current.rollback /opt/kimia/current
  systemctl restart kimia
  wait_for_health || echo 'Previous release also needs operator attention.' >&2
  return 1
}

main() {
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
  [[ $EUID == 0 && $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || return 2
  local revision=$1 previous target staging backup stamp
  exec 9>/run/lock/kimia-deploy.lock
  flock -n 9 || { echo 'A Kimia deployment is already running.' >&2; return 1; }
  previous=$(readlink -f /opt/kimia/current)
  [[ $previous == /opt/kimia/releases/* && -s $previous/server/index.js ]] || return 1
  target=/opt/kimia/releases/$revision
  if [[ $previous == "$target" ]]; then
    wait_for_health && health_ready https://kbkimiabeauty.ir/api/health || return 1
    echo "Requested Kimia revision is already active and healthy: $revision"
    return 0
  fi
  [[ ! -e $target && ! -L $target ]] || { echo 'Release exists; inspect it before retrying.' >&2; return 1; }
  test -r /etc/kimia/kimia.env
  test -d /var/lib/kimia/uploads
  /usr/sbin/runuser -u kimia-deploy -- /usr/local/lib/kimia/build-release "$revision"

  # Snapshot first; never run repository scripts or npm as root.
  staging=$(mktemp -d /opt/kimia/releases/.staging-XXXXXXXX)
  cp -a /var/lib/kimia-deploy/repository/. "$staging/"
  rm -rf -- "$staging/.git"
  chown -R root:kimia "$staging"
  chmod -R u=rwX,g=rX,o= "$staging"
  test -s "$staging/dist/server/index.js"

  # Fixed backup commands: no repository-controlled root scripts and no migrations.
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup=/var/backups/kimia/deploy-$stamp-$revision
  install -d -o root -g root -m 0700 "$backup"
  /usr/sbin/runuser -u postgres -- /usr/bin/pg_dump --format=custom --no-owner --dbname=kimia > "$backup/kimia.dump"
  tar -czf "$backup/uploads.tar.gz" -C /var/lib/kimia/uploads .
  (cd "$backup" && sha256sum kimia.dump uploads.tar.gz > SHA256SUMS)
  chmod 0600 "$backup/kimia.dump" "$backup/uploads.tar.gz" "$backup/SHA256SUMS"
  printf 'Backup complete: %s\n' "$backup"
  mv "$staging" "$target"
  printf 'Previous release: %s\n' "$previous"
  activate_release "$target" "$previous"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
