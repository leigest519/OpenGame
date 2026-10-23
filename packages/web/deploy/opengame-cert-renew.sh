#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Other certificates on this host keep their existing deployment behavior.
if [ "${RENEWED_LINEAGE:-}" != /etc/letsencrypt/live/opengame-studio ]; then
    exit 0
fi
nginx -t
systemctl reload nginx
