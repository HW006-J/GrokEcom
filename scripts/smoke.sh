#!/usr/bin/env bash
# Smoke test the API against a running dev server. Requires .env.local + seeded Supabase.
set -u
BASE="${BASE:-http://localhost:3000}"
SHOW="${SHOW:-00000000-0000-0000-0000-000000000001}"
post() { curl -s -o /tmp/smoke_body -w "%{http_code}" -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }

echo "message:"; post /api/message "{\"showId\":\"$SHOW\",\"name\":\"Smoke\",\"text\":\"does it run small?\"}"; echo; cat /tmp/smoke_body; echo
echo "bid (expect 409 unless in auction):"; post /api/bid "{\"showId\":\"$SHOW\",\"name\":\"Smoke\",\"amount\":10}"; echo; cat /tmp/smoke_body; echo
echo "tick x3:"; for i in 1 2 3; do post /api/host/tick "{\"showId\":\"$SHOW\"}"; echo; cat /tmp/smoke_body; echo; done
echo "session-token:"; post /api/session-token '{}'; echo; head -c 120 /tmp/smoke_body; echo
