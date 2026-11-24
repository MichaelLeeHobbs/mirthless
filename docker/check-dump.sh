#!/bin/sh
# Usage: sh docker/check-dump.sh <file>
# Reads a GalvaniGraph database dump (pg_dump -F c) back without restoring it. Prints "dump OK" and exits 0 if it can be read.

set -eu
file=${1:?usage: check-dump.sh <file>}
# The production database's image (docker-compose.prod.yml). It runs in its own container, so a damaged
# file cannot take memory from the database.
image=postgres:17-alpine

# Reads all the data.
docker run --rm -i --network none "$image" pg_restore -f /dev/null < "$file" || {
  echo "$file: NOT OK, pg_restore could not read it" >&2
  exit 1
}
# pg_restore takes a damaged header for an empty archive and exits 0 (#361), so the tables must be there too.
docker run --rm -i --network none "$image" pg_restore --list < "$file" | grep ' TABLE DATA public channels ' > /dev/null || {
  echo "$file: NOT OK, it does not hold the channels table" >&2
  exit 1
}
echo "dump OK: $file"
