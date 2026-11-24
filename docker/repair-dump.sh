#!/bin/sh
# Usage: sh docker/repair-dump.sh <file>
# For a dump taken with `docker exec -t` (#361): writes <file>.repaired, without the carriage return the TTY put
# before each newline byte. Never changes <file>, refuses a dump that is not damaged this way, and never overwrites.

set -eu
file=${1:?usage: repair-dump.sh <file>}
out="$file.repaired"

if [ ! -f "$file" ] || [ ! -r "$file" ]; then
  echo "$file: cannot be read" >&2
  exit 1
fi
if [ -e "$out" ]; then
  echo "$out: already exists" >&2
  exit 1
fi

umask 077
trap 'rm -f "$out.partial"' EXIT
trap 'exit 1' HUP INT TERM

perl -ne 'die "not taken with -t, leave it as it is\n" unless s/\r\n\z/\n/ || !/\n\z/; print' "$file" > "$out.partial"
sh "$(dirname "$0")/check-dump.sh" "$out.partial" > /dev/null
mv "$out.partial" "$out"
echo "dump OK: $out"
