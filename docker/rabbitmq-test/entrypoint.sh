#!/bin/sh
# Test-only: give the broker a TLS listener without a setup step on the host.
# On first start this writes a throwaway CA and a server certificate (localhost,
# 127.0.0.1, rabbitmq-test) into /certs, which compose binds to docker/test-certs.
# The integration suite trusts docker/test-certs/ca.pem. Delete the .pem files
# there and restart the container to replace them. Never use them outside tests.
set -eu

if [ ! -s /certs/server.pem ]; then
  cd /certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout ca-key.pem -out ca.pem -subj "/CN=GalvaniFlow test CA" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes \
    -keyout server-key.pem -out server.csr -subj "/CN=localhost" 2>/dev/null
  printf 'subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:rabbitmq-test\nextendedKeyUsage=serverAuth\n' > server.ext
  openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
    -days 3650 -extfile server.ext -out server.pem 2>/dev/null
  rm -f server.csr server.ext ca.srl
  # The broker drops to the rabbitmq user, which must read the key.
  chmod 644 ca.pem server.pem server-key.pem
  cd /
fi

exec docker-entrypoint.sh "$@"
