#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: sudo deploy/restore-db-to-new.sh kimia_restore_NAME /absolute/path/kimia.dump" >&2
  exit 2
fi

database=$1
dump=$2
case "$database" in
  kimia_restore_*) ;;
  *) echo "Target database must start with kimia_restore_ and use lowercase letters, digits or underscores." >&2; exit 2 ;;
esac
suffix=${database#kimia_restore_}
case "$suffix" in
  ''|*[!a-z0-9_]*) echo "Target database suffix must use lowercase letters, digits or underscores." >&2; exit 2 ;;
esac
if [ "${#database}" -gt 63 ]; then
  echo "Target database name exceeds PostgreSQL's 63-byte identifier limit." >&2
  exit 2
fi
if [ ! -f "$dump" ]; then
  echo "Backup file not found." >&2
  exit 2
fi

sudo -u postgres createdb --owner=kimia_app "$database"
sudo -u postgres pg_restore --exit-on-error --no-owner --role=kimia_app --dbname="$database" - < "$dump"
printf 'Restored to new database %s; the source database was not changed.\n' "$database"
