#!/usr/bin/env bash
# CI only: a throwaway PostgreSQL 17 in Docker for `SHIPSHAPE_PG_TEST_URL` runs (README, "Run it").
# Like RDS with rds.force_ssl: TCP connections must use TLS (hostssl only), with a certificate for
# localhost signed by a CA made here, so the app's driver verifies it exactly as it verifies RDS.
# Writes <dir>/ca.pem and <dir>/url (a superuser URL with a random password). Never prints either.
set -euo pipefail

dir=${1:?usage: scripts/ci-postgres.sh <dir>}
image=postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5
mkdir -p "$dir"
cd "$dir"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=ShipShape CI test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout server.key -out server.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > server.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -extfile server.ext -out server.crt 2>/dev/null
rm ca.key server.csr server.ext
# The image's first-start setup connects over the local socket; everything over TCP needs TLS.
printf 'local all all trust\nhostssl all all all scram-sha-256\n' > pg_hba.conf

password=$(openssl rand -hex 24)
docker run -d --name shipshape-ci-pg -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD="$password" \
  -v "$PWD:/ci:ro" --entrypoint bash "$image" -c '
    install -o postgres -m 600 /ci/server.key /var/lib/postgresql/server.key
    install -o postgres -m 644 /ci/server.crt /ci/pg_hba.conf /var/lib/postgresql/
    exec docker-entrypoint.sh postgres -c ssl=on -c hba_file=/var/lib/postgresql/pg_hba.conf \
      -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key' >/dev/null
rm server.key

# Ready once the final server (not the image's setup server, which has no TCP) answers on TCP.
for _ in $(seq 60); do
  if docker exec shipshape-ci-pg pg_isready -q -h 127.0.0.1 -U postgres; then
    printf 'postgres://postgres:%s@localhost:5432/postgres\n' "$password" > url
    echo "PostgreSQL 17 ready on localhost:5432 (TLS only over TCP)"
    exit 0
  fi
  sleep 1
done
docker logs shipshape-ci-pg | tail -20
exit 1
