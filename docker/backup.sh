#!/bin/sh
# Usage: sh docker/backup.sh <directory>
# Dumps the database into <directory>/galvanigraph-<UTC time>.dump. The file is there only if check-dump.sh could read it back.
# Set DB_CONTAINER, POSTGRES_USER and POSTGRES_DB for an install whose names differ.

set -eu
dir=${1:?usage: backup.sh <directory>}
container=${DB_CONTAINER:-galvanigraph-db-prod}
file="$dir/galvanigraph-$(date -u +%Y%m%d-%H%M%S).dump"

# The dump holds PHI: readable by its owner only.
umask 077
trap 'rm -f "$file.partial"' EXIT
trap 'exit 1' HUP INT TERM

# Never -t: a TTY writes each newline byte of the dump as CR LF, and it cannot be restored (#361).
docker exec "$container" pg_dump -U "${POSTGRES_USER:-galvanigraph}" -d "${POSTGRES_DB:-galvanigraph}" -F c > "$file.partial"
sh "$(dirname "$0")/check-dump.sh" "$file.partial" > /dev/null
mv "$file.partial" "$file"
echo "dump OK: $file"
