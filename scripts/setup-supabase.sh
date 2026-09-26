#!/usr/bin/env bash
# Creates the ClosetLive Supabase project, applies schema + seed, wires .env.local and Railway.
# Requires: supabase CLI logged in (`supabase login`). Run from the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-closetlive}"
REGION="${REGION:-eu-west-2}"

# --- access token: env, then macOS keychain (written by `supabase login`) ---
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null || true)
fi
if [ -z "$TOKEN" ]; then
  for f in "$HOME/.supabase/access-token" "$HOME/Library/Application Support/supabase/access-token"; do
    [ -f "$f" ] && TOKEN=$(tr -d '[:space:]' < "$f") && break
  done
fi
[ -n "$TOKEN" ] || { echo "No Supabase access token. Run: supabase login   (or export SUPABASE_ACCESS_TOKEN=sbp_...)"; exit 1; }
export SUPABASE_ACCESS_TOKEN="$TOKEN"

api() { curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

# --- reuse an existing project with this name, else create one ---
REF=$(api https://api.supabase.com/v1/projects | python3 -c "
import json,sys
ps=json.load(sys.stdin)
print(next((p['id'] for p in ps if p['name']=='$NAME'), ''))")

DBPASS_FILE=".supabase-db-password"
if [ -z "$REF" ]; then
  ORG=$(api https://api.supabase.com/v1/organizations | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
  DBPASS=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28)
  printf '%s' "$DBPASS" > "$DBPASS_FILE"; chmod 600 "$DBPASS_FILE"
  echo "Creating project $NAME in $REGION ..."
  REF=$(api -X POST https://api.supabase.com/v1/projects -d "$(python3 -c "
import json
print(json.dumps({'name':'$NAME','organization_id':'$ORG','region':'$REGION','db_pass':'$DBPASS','plan':'free'}))")" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d)")
  echo "Project ref: $REF"
else
  echo "Reusing existing project $NAME ($REF)"
fi

# --- wait for it to come up ---
printf 'Waiting for project to be healthy'
for _ in $(seq 1 60); do
  ST=$(api "https://api.supabase.com/v1/projects/$REF" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  [ "$ST" = "ACTIVE_HEALTHY" ] && break
  printf '.'; sleep 10
done
echo " $ST"

# --- keys ---
KEYS=$(api "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true")
ANON=$(printf '%s' "$KEYS" | python3 -c "
import json,sys
ks=json.load(sys.stdin)
print(next((k['api_key'] for k in ks if k.get('name')=='anon'), ''))")
SERVICE=$(printf '%s' "$KEYS" | python3 -c "
import json,sys
ks=json.load(sys.stdin)
print(next((k['api_key'] for k in ks if k.get('name')=='service_role'), ''))")
[ -n "$ANON" ] && [ -n "$SERVICE" ] || { echo "Could not read API keys"; printf '%s\n' "$KEYS" | head -c 400; exit 1; }
URL="https://$REF.supabase.co"

# --- apply schema + seed via the Management API SQL endpoint ---
run_sql() {
  python3 - "$1" <<'PY' > /tmp/cl_sql.json
import json,sys
print(json.dumps({"query": open(sys.argv[1]).read()}))
PY
  api -X POST "https://api.supabase.com/v1/projects/$REF/database/query" --data @/tmp/cl_sql.json
}
echo "Applying schema ..."; run_sql supabase/schema.sql | head -c 300; echo
echo "Applying seed ...";   run_sql supabase/seed.sql   | head -c 300; echo

# --- write .env.local (preserve existing keys) ---
python3 - "$URL" "$ANON" "$SERVICE" <<'PY'
import sys, pathlib, re
url, anon, service = sys.argv[1:4]
p = pathlib.Path('.env.local')
txt = p.read_text() if p.exists() else ''
vals = {'NEXT_PUBLIC_SUPABASE_URL': url, 'NEXT_PUBLIC_SUPABASE_ANON_KEY': anon, 'SUPABASE_SERVICE_ROLE_KEY': service}
for k, v in vals.items():
    if re.search(rf'^{k}=', txt, re.M):
        txt = re.sub(rf'^{k}=.*$', f'{k}={v}', txt, flags=re.M)
    else:
        txt += ('' if txt.endswith('\n') or not txt else '\n') + f'{k}={v}\n'
p.write_text(txt)
print('.env.local updated')
PY

# --- Railway ---
if command -v railway >/dev/null; then
  railway variables --set "NEXT_PUBLIC_SUPABASE_URL=$URL" \
                    --set "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON" \
                    --set "SUPABASE_SERVICE_ROLE_KEY=$SERVICE" --skip-deploys >/dev/null 2>&1 \
    && echo "Railway variables set" || echo "Railway variables NOT set (link the service first)"
fi

echo
echo "Project ref : $REF"
echo "URL         : $URL"
echo "Dashboard   : https://supabase.com/dashboard/project/$REF"
echo "Next        : npm run dev, then bash scripts/smoke.sh"
