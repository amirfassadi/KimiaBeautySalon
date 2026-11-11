#!/bin/sh
set -eu
umask 077

backup_dir=${1:-/var/backups/kimia}
upload_dir=${UPLOAD_DIR:-/var/lib/kimia/uploads}
stamp=$(date -u +%Y%m%dT%H%M%SZ)

if [ ! -d "$upload_dir" ]; then
  echo "Upload directory is missing: $upload_dir" >&2
  exit 1
fi
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
db_file="$backup_dir/kimia-$stamp.dump"
images_file="$backup_dir/kimia-images-$stamp.tar.gz"

sudo -u postgres pg_dump --format=custom --no-owner --dbname=kimia > "$db_file"
tar --create --gzip --file="$images_file" --directory="$upload_dir" .
sha256sum "$db_file" "$images_file" > "$backup_dir/kimia-$stamp.sha256"
chmod 600 "$db_file" "$images_file" "$backup_dir/kimia-$stamp.sha256"
printf 'Created database and image backups at %s\n' "$backup_dir"
