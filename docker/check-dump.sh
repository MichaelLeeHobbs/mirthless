#!/bin/sh
# Usage: sh docker/check-dump.sh <file>
# Reads a GalvaniGraph database dump (pg_dump -F c) back without restoring it. Exits 0 with "dump OK" if it can be read,
# 1 if it cannot, and 2 if the check could not be run.

set -eu
file=${1:?usage: check-dump.sh <file>}
# The production database's image (docker-compose.prod.yml), in a container of its own, not the database's.
image=postgres:17-alpine

pg_restore_file() {
  docker run --rm -i --init --network none "$image" pg_restore "$@" < "$file"
}

not_ok() {
  echo "$file: NOT OK, $1" >&2
  exit 1
}

# 125 and up come from Docker or a signal, not from pg_restore.
stop_if_not_run() {
  if [ "$1" -ge 125 ]; then
    echo "The check did not run (docker run exited $1). This says nothing about $file" >&2
    exit 2
  fi
}

if [ ! -f "$file" ] || [ ! -r "$file" ]; then
  echo "$file: cannot be read" >&2
  exit 1
fi

# Reads all the data.
status=0
pg_restore_file -f /dev/null || status=$?
stop_if_not_run "$status"
[ "$status" -eq 0 ] || not_ok 'pg_restore could not read it'

# pg_restore takes a damaged header for an empty archive and exits 0 (#361), so the tables must be there too.
contents=$(pg_restore_file --list) || status=$?
stop_if_not_run "$status"
[ "$status" -eq 0 ] || not_ok 'pg_restore could not list it'
case "$contents" in
  *' TABLE DATA public channels '*) echo "dump OK: $file" ;;
  *) not_ok 'it does not hold the channels table' ;;
esac
