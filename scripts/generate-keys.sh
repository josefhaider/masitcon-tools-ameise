#!/usr/bin/env bash
# ===================================================================
# Ameise - Supabase Key Generator
# ===================================================================
# Generiert JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY und POSTGRES_PASSWORD.
# Gibt die Werte als KEY=VALUE Paare auf stdout aus.
#
# Verwendung:
#   bash scripts/generate-keys.sh              # Gibt Keys auf stdout aus
#   eval "$(bash scripts/generate-keys.sh)"    # Setzt Keys als Env-Vars
# ===================================================================
set -euo pipefail

# Base64URL-Encoding (ohne Padding)
base64url_encode() {
    openssl base64 -e -A | tr '+/' '-_' | tr -d '='
}

# JWT-Token generieren (HS256)
generate_jwt() {
    local role="$1"
    local secret="$2"
    local iat exp

    iat=$(date +%s)
    exp=4102444800  # 2099-12-31T00:00:00Z

    local header payload
    header=$(printf '{"alg":"HS256","typ":"JWT"}' | base64url_encode)
    payload=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$role" "$iat" "$exp" | base64url_encode)

    local signature
    signature=$(printf '%s.%s' "$header" "$payload" \
        | openssl dgst -sha256 -hmac "$secret" -binary \
        | base64url_encode)

    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

if ! command -v openssl >/dev/null 2>&1; then
    echo "FEHLER: openssl ist nicht installiert." >&2
    exit 1
fi

# Generiere Secrets
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/\n' | head -c 32)

# Generiere JWT Tokens
ANON_KEY=$(generate_jwt "anon" "$JWT_SECRET")
SERVICE_ROLE_KEY=$(generate_jwt "service_role" "$JWT_SECRET")

# Ausgabe
cat << EOF
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
EOF
