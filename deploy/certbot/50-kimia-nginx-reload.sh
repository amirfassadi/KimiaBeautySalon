#!/bin/sh
set -eu

expected_lineage=/etc/letsencrypt/live/kbkimiabeauty.ir
if [ "${RENEWED_LINEAGE:-}" != "$expected_lineage" ]; then
  exit 0
fi

renewed_domains=" ${RENEWED_DOMAINS:-} "
case "$renewed_domains" in
  *" kbkimiabeauty.ir "*) ;;
  *)
    echo "Kimia certificate renewal hook skipped: expected apex and www domains." >&2
    exit 1
    ;;
esac
case "$renewed_domains" in
  *" www.kbkimiabeauty.ir "*) ;;
  *)
    echo "Kimia certificate renewal hook skipped: expected apex and www domains." >&2
    exit 1
    ;;
esac

/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
