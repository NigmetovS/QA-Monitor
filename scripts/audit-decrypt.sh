#!/usr/bin/env bash
# Расшифровка результатов аудита из ветки audit-data.
#   bash scripts/audit-decrypt.sh runs/audit-<id>.enc private.pem [папка]
set -euo pipefail
enc="$1"; priv="$2"; out="${3:-audit-results-decrypted}"
key="$(mktemp)"
trap 'rm -f "$key"' EXIT
openssl pkeyutl -decrypt -inkey "$priv" -pkeyopt rsa_padding_mode:oaep -in "${enc%.enc}.key" -out "$key"
mkdir -p "$out"
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$key" -in "$enc" | tar -xz -C "$out"
echo "Готово: $out"
