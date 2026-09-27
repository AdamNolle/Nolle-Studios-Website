#!/bin/sh
set -eu

backup_dir=${NOLLE_BACKUP_DIR:-/srv/data/backups/nolle-studios}
database_container=${NOLLE_DB_CONTAINER:-nolle-studios-db-1}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_dir/nolle-$stamp.dump"
temporary="$destination.tmp"

install -d -m 700 "$backup_dir"
trap 'rm -f "$temporary"' EXIT HUP INT TERM

docker exec "$database_container" pg_dump \
  --username=nolle --dbname=nolle --format=custom --no-owner --no-privileges > "$temporary"
docker exec -i "$database_container" pg_restore --list < "$temporary" > /dev/null
chmod 600 "$temporary"
mv "$temporary" "$destination"
trap - EXIT HUP INT TERM

printf 'Verified PostgreSQL backup: %s\n' "$destination"
