#!/usr/bin/env bash
# End-to-end test of MCP tokens + the remote MCP endpoint against a LOCAL server.
#
#   1. mysql -u USER -p DB < server/schema.sql        (a throwaway local database)
#   2. server/api/config.php with 'mail' => ['transport' => 'log', ...] and 'debug' => true
#   3. npm run mcp:install                            (composer install in server/mcp)
#   4. npm run dev:api                                (php -S 127.0.0.1:8787 -t server)
#   5. server/tests/mcp-smoke.sh
#
# Like api-smoke.sh it reads captcha answers from PHP session files and links from mail.log, and
# it edits token expiry directly in the configured database — so it only works against the
# built-in PHP server on the same machine. Never run it against a real deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="${BASE:-http://127.0.0.1:8787}"
API="$BASE/api/index.php"
MCP="$BASE/mcp/"
MAIL_LOG="${MAIL_LOG:-$ROOT/server/mail.log}"
SESSIONS="$(php -r 'echo session_save_path() ?: sys_get_temp_dir();')"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILURES=0
PASSWORD="secret123"

# --- helpers -------------------------------------------------------------------------------
# JSON field from stdin: jget '["a"][0]["b"]'  (prints "" when missing)
jget() { python3 -c "import sys,json
try:
  d=json.load(sys.stdin); v=d$1
  print(json.dumps(v) if isinstance(v,(dict,list)) else ('' if v is None else v))
except Exception: print('')"; }
# Tool result → its JSON payload (the text content), from a JSON-RPC response on stdin.
payload() { python3 -c "import sys,json
d=json.load(sys.stdin)
if 'error' in d: print(json.dumps({'rpc_error': d['error']})); sys.exit()
r=d['result']; t=r['content'][0]['text']; print(t if not r.get('isError') else t + ' [isError]')"; }
expect() { # name, haystack, needle
  if [[ "$2" == *"$3"* ]]; then echo "ok   $1"; else echo "FAIL $1: expected '$3' in: ${2:0:600}"; FAILURES=$((FAILURES + 1)); fi
}
refute() { # name, haystack, needle
  if [[ "$2" != *"$3"* ]]; then echo "ok   $1"; else echo "FAIL $1: did not expect '$3' in: ${2:0:600}"; FAILURES=$((FAILURES + 1)); fi
}
sql() { # run one statement against the configured (local!) database
  php -r 'require $argv[1]."/server/api/lib/bootstrap.php"; $s = wf_db()->prepare($argv[2]); $s->execute(array_slice($argv, 3)); $r = $s->columnCount() ? $s->fetchAll() : []; echo json_encode($r);' "$ROOT" "$@"
}
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

# Browser API, one cookie jar per user.
api_get() { curl -s -b "$TMP/$1.jar" -c "$TMP/$1.jar" "$API?action=$2"; }
api_post() { curl -s -b "$TMP/$1.jar" -c "$TMP/$1.jar" -H "X-CSRF-Token: $(cat "$TMP/$1.csrf")" -H 'Content-Type: application/json' -d "$3" "$API?action=$2"; }
captcha_answer() {
  curl -s -b "$TMP/$1.jar" -c "$TMP/$1.jar" "$API?action=captcha" > /dev/null
  local sid; sid=$(awk '$6=="wf_sid"{print $7}' "$TMP/$1.jar")
  php -r 'ini_set("session.save_path", sys_get_temp_dir()); @session_start(); session_decode(file_get_contents($argv[1])); echo $_SESSION["captcha"]["answer"];' "$SESSIONS/sess_$sid" 2>/dev/null
}
signup() { # user → verified + signed in
  local email="mcp$RANDOM$RANDOM@example.test"
  api_get "$1" status | jget '["csrf"]' > "$TMP/$1.csrf"
  local body; body=$(printf '{"email":"%s","password":"%s","captcha":"%s","acceptPrivacy":true}' "$email" "$PASSWORD" "$(captcha_answer "$1")")
  api_post "$1" register "$body" > /dev/null
  local token; token=$(grep -o "verify=[A-Za-z0-9_-]*" "$MAIL_LOG" | tail -1 | cut -d= -f2)
  local verified; verified=$(api_post "$1" verify "$(printf '{"token":"%s"}' "$token")")
  echo "$verified" | jget '["csrf"]' > "$TMP/$1.csrf"
}
new_token() { # user, scopes JSON → raw token
  api_post "$1" mcp-token-create "$(printf '{"name":"smoke","scopes":%s,"expiresInDays":90,"password":"%s"}' "$2" "$PASSWORD")" | jget '["token"]'
}

# MCP over Streamable HTTP. rpc TOKEN SESSION METHOD PARAMS_JSON [extra curl args...]
RPC_ID=0
rpc() {
  local token="$1" session="$2" method="$3" params="$4"; shift 4
  RPC_ID=$((RPC_ID + 1))
  local headers=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
  [[ -n "$token" ]] && headers+=(-H "Authorization: Bearer $token")
  [[ -n "$session" ]] && headers+=(-H "Mcp-Session-Id: $session" -H 'MCP-Protocol-Version: 2025-11-25')
  curl -s "${headers[@]}" "$@" -d "{\"jsonrpc\":\"2.0\",\"id\":$RPC_ID,\"method\":\"$method\",\"params\":$params}" "$MCP"
}
handshake() { # token → session id
  curl -s -D "$TMP/h" -o /dev/null -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -H "Authorization: Bearer $1" \
    -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"mcp-smoke","version":"1"}}}' "$MCP"
  local session; session=$(grep -i '^mcp-session-id:' "$TMP/h" | tr -d '\r' | awk '{print $2}')
  curl -s -o /dev/null -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "Authorization: Bearer $1" \
    -H "Mcp-Session-Id: $session" -H 'MCP-Protocol-Version: 2025-11-25' -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$MCP"
  echo "$session"
}
tool() { # token session name args_json → tool payload JSON
  rpc "$1" "$2" tools/call "{\"name\":\"$3\",\"arguments\":$4}" | payload
}

# --- setup ---------------------------------------------------------------------------------
signup alice
signup bob

# --- token lifecycle (browser API: session + CSRF + password) ------------------------------
R=$(api_get alice mcp-tokens); expect "token list starts empty" "$R" '"tokens":[]'
expect "endpoint advertised" "$R" '"endpoint":"'
R=$(curl -s -b "$TMP/alice.jar" -H 'Content-Type: application/json' -d '{"name":"x","password":"secret123"}' "$API?action=mcp-token-create")
expect "token create needs CSRF" "$R" '"csrf"'
R=$(api_post alice mcp-token-create '{"name":"x","password":"wrong-password"}'); expect "token create needs password" "$R" '"bad_credentials"'
R=$(api_post alice mcp-token-create "{\"name\":\"x\",\"scopes\":[\"write\"],\"password\":\"$PASSWORD\",\"expiresInDays\":90}"); expect "token needs read" "$R" '"bad_scopes"'
R=$(api_post alice mcp-token-create "{\"name\":\"x\",\"password\":\"$PASSWORD\",\"expiresInDays\":7}"); expect "only offered expiries" "$R" '"bad_expiry"'
R=$(api_post alice mcp-token-create "{\"name\":\"Claude Code\",\"password\":\"$PASSWORD\",\"expiresInDays\":90}")
RW=$(echo "$R" | jget '["token"]')
expect "raw token returned once at creation" "$RW" "wf_mcp_"
expect "default scopes read+write" "$(echo "$R" | jget '["record"]["scopes"]')" '["read", "write"]'
L=$(api_get alice mcp-tokens)
refute "listing never returns the raw token" "$L" "$RW"
refute "listing never returns the hash" "$L" "$(sha "$RW")"
expect "listing shows the prefix" "$L" "\"prefix\":\"${RW:0:12}\""
ROW=$(sql 'SELECT token_hash, token_prefix, scopes FROM wf_mcp_tokens WHERE token_hash = ?' "$(sha "$RW")")
expect "database stores SHA-256 of the token" "$ROW" '"scopes":"read write"'
refute "database never stores the raw token" "$(sql 'SELECT * FROM wf_mcp_tokens')" "${RW:12}"
RO=$(new_token alice '["read"]')
RWD=$(new_token alice '["read","write","delete"]')
BOB=$(new_token bob '["read","write","delete"]')

# --- authentication ------------------------------------------------------------------------
R=$(curl -s -D - -o /dev/null -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$MCP")
expect "no token → 401" "$R" "401"; expect "401 carries a Bearer challenge" "$R" 'WWW-Authenticate: Bearer'
R=$(rpc "wf_mcp_$(printf 'x%.0s' {1..43})" "" tools/list '{}' -w ' HTTP%{http_code}'); expect "unknown token → 401" "$R" 'HTTP401'
R=$(rpc "$RW" "" tools/list '{}' -w ' HTTP%{http_code}' -H 'Host: evil.example'); expect "foreign Host rejected (DNS rebinding)" "$R" 'HTTP403'
R=$(rpc "$RW" "" tools/list '{}' -D - -H 'Origin: https://evil.example'); expect "foreign Origin rejected" "$R" '403'
R=$(rpc "$RW" "" tools/list '{}' -D - -H "Origin: http://localhost:5173"); refute "no CORS allow-origin by default" "$R" 'Access-Control-Allow-Origin'

# --- handshake-era session -----------------------------------------------------------------
S=$(handshake "$RW"); expect "initialize returns an MCP session" "$S" '-'
R=$(rpc "$RW" "$S" tools/list '{}')
for name in list_projects get_wirefragma_schema get_wireframe create_project rename_project create_wireframe update_wireframe rename_wireframe duplicate_wireframe delete_wireframe delete_project; do
  expect "tools/list has $name" "$R" "\"name\":\"$name\""
done
refute "no force option is exposed" "$R" '"force"'

# --- reads ---------------------------------------------------------------------------------
P=$(tool "$RW" "$S" list_projects '{}'); expect "list_projects sees the starter project" "$P" '"My first project"'
refute "list_projects has no documents" "$P" '"elements"'
WID=$(echo "$P" | jget '["projects"][0]["wireframes"][0]["id"]')
W=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$WID}"); expect "get_wireframe returns the document" "$W" '"elements":[]'
expect "get_wireframe returns the revision" "$W" '"revision":1'
BP=$(api_get bob projects); BWID=$(echo "$BP" | jget '["projects"][0]["wireframes"][0]["id"]'); BPID=$(echo "$BP" | jget '["projects"][0]["id"]')
R=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$BWID}"); expect "another user's wireframe is not_found" "$R" '"error":"not_found"'
R=$(tool "$RW" "$S" rename_project "{\"projectId\":$BPID,\"name\":\"pwned\"}"); expect "another user's project is not_found" "$R" '"error":"not_found"'
expect "bob's project untouched" "$(api_get bob projects)" '"My first project"'
R=$(tool "$RW" "$S" get_wirefragma_schema '{}'); expect "schema tool returns the MCP schema" "$R" 'update_wireframe'
R=$(rpc "$RW" "$S" resources/read '{"uri":"wirefragma://schema"}'); expect "schema resource" "$R" 'WIREFRAGMA project format'
R=$(rpc "$RW" "$S" resources/read "{\"uri\":\"wirefragma://wireframes/$WID\"}"); expect "wireframe resource" "$R" '\"revision\":1'
R=$(rpc "$RW" "$S" resources/read "{\"uri\":\"wirefragma://wireframes/$BWID\"}"); expect "wireframe resource is user-scoped" "$R" '"error"'
R=$(rpc "$RW" "$S" resources/read '{"uri":"wirefragma://projects"}'); expect "projects resource" "$R" 'My first project'
R=$(rpc "$RW" "$S" resources/templates/list '{}'); expect "wireframe resource template" "$R" '"uriTemplate":"wirefragma:\/\/wireframes\/{id}"'

# --- writes --------------------------------------------------------------------------------
R=$(tool "$RW" "$S" create_project '{"name":"MCP app"}'); expect "create_project" "$R" '"projectId":'
NPID=$(echo "$R" | jget '["projectId"]'); expect "create_project adds Screen 1" "$R" '"title":"Screen 1"'
R=$(tool "$RW" "$S" create_project '{"name":"Empty","withWireframe":false}'); expect "create_project without wireframe" "$R" '"wireframeId":null'
# A document with fields the server does not know: {} must stay {}, {"0":…} must stay an object.
DOC='{"version":2,"title":"ignored","canvas":{"mode":"mobile","width":390,"height":844},"layers":[{"id":"layer_a","name":"A","visible":true,"locked":false}],"elements":[{"id":"el_1","type":"button","name":"save","label":"Save","note":"","x":16,"y":16,"width":120,"height":40,"layerId":"layer_a","visible":true,"locked":false,"zIndex":0,"futureField":{},"futureMap":{"0":"a"},"ratio":1.0}],"futureTop":{"nested":[]}}'
R=$(tool "$RW" "$S" create_wireframe "{\"projectId\":$NPID,\"title\":\"Settings\",\"data\":$DOC}"); expect "create_wireframe with data" "$R" '"revision":1'
NWID=$(echo "$R" | jget '["wireframeId"]')
W=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$NWID}")
expect "unknown empty object survives" "$W" '"futureField":{}'
expect "numeric-key object survives" "$W" '"futureMap":{"0":"a"}'
expect "unknown top-level field survives" "$W" '"futureTop":{"nested":[]}'
expect "float zero fraction survives" "$W" '"ratio":1.0'
expect "document title synced to wireframe title" "$W" '"title":"Settings","canvas"'
BAD='{"version":2,"title":"x","canvas":{"mode":"desktop","width":800,"height":600},"layers":[{"id":"l","name":"L"}],"elements":[{"id":"e","type":"hologram","name":"n","x":0,"y":0,"width":10,"height":10,"layerId":"l"}]}'
R=$(tool "$RW" "$S" create_wireframe "{\"projectId\":$NPID,\"title\":\"Bad\",\"data\":$BAD}"); expect "invalid element type rejected" "$R" '"error":"bad_document"'
R=$(tool "$RW" "$S" update_wireframe "{\"wireframeId\":$NWID,\"baseRevision\":1,\"data\":{\"x\":1}}"); expect "non-project rejected" "$R" '"error":"bad_document"'

DOC2=${DOC/\"label\":\"Save\"/\"label\":\"Save changes\"}
R=$(tool "$RW" "$S" update_wireframe "{\"wireframeId\":$NWID,\"baseRevision\":1,\"data\":$DOC2}"); expect "update_wireframe bumps the revision" "$R" '"revision":2'
DOC3=${DOC/\"label\":\"Save\"/\"label\":\"Stale edit\"}
R=$(tool "$RW" "$S" update_wireframe "{\"wireframeId\":$NWID,\"baseRevision\":1,\"data\":$DOC3}")
expect "stale update is a conflict" "$R" '"error":"conflict"'
expect "conflict returns the current revision" "$R" '"revision":2'
expect "conflict returns the current document" "$R" 'Save changes'
W=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$NWID}"); refute "conflict never overwrites" "$W" 'Stale edit'

# Browser and MCP share revisions: a browser save moves MCP's baseline, and vice versa.
BDOC=${DOC/\"label\":\"Save\"/\"label\":\"From the browser\"}
R=$(api_post alice wireframe-save "{\"id\":$NWID,\"baseRevision\":2,\"title\":\"Settings\",\"data\":$BDOC}"); expect "browser save on top of MCP save" "$R" '"revision":3'
W=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$NWID}"); expect "MCP reads the browser's save" "$W" 'From the browser'
expect "same revision counter" "$W" '"revision":3'
R=$(api_post alice wireframe-save "{\"id\":$NWID,\"baseRevision\":2,\"title\":\"Settings\",\"data\":$BDOC}"); expect "browser sees stale-revision conflicts too" "$R" '"conflict"'
B=$(api_get alice "wireframe&id=$NWID"); expect "browser API keeps unknown fields losslessly" "$B" '"futureField":{}'

R=$(tool "$RW" "$S" rename_wireframe "{\"wireframeId\":$NWID,\"title\":\"Account settings\"}"); expect "rename_wireframe returns new revision" "$R" '"revision":4'
W=$(tool "$RW" "$S" get_wireframe "{\"wireframeId\":$NWID}"); expect "rename syncs data.title" "$W" '"title":"Account settings","canvas"'
R=$(tool "$RW" "$S" duplicate_wireframe "{\"wireframeId\":$NWID}"); expect "duplicate uses '<title> copy'" "$R" '"title":"Account settings copy"'
DUPID=$(echo "$R" | jget '["wireframeId"]')
R=$(tool "$RW" "$S" duplicate_wireframe "{\"wireframeId\":$NWID,\"title\":\"Variant B\"}"); expect "duplicate with explicit title" "$R" '"title":"Variant B"'
R=$(tool "$RW" "$S" rename_project "{\"projectId\":$NPID,\"name\":\"MCP app v2\"}"); expect "rename_project" "$R" '"name":"MCP app v2"'
expect "browser tree sees MCP changes" "$(api_get alice projects)" 'Account settings copy'

# --- scopes --------------------------------------------------------------------------------
S2=$(handshake "$RO")
R=$(tool "$RO" "$S2" list_projects '{}'); expect "read-only token can read" "$R" '"projects"'
R=$(tool "$RO" "$S2" create_project '{"name":"nope"}'); expect "read-only token cannot write" "$R" '"error":"forbidden_scope"'
R=$(tool "$RW" "$S" delete_wireframe "{\"wireframeId\":$DUPID,\"confirmTitle\":\"Account settings copy\"}"); expect "write token cannot delete" "$R" '"error":"forbidden_scope"'
S3=$(handshake "$RWD")
R=$(tool "$RWD" "$S3" delete_wireframe "{\"wireframeId\":$DUPID,\"confirmTitle\":\"wrong\"}"); expect "delete needs the exact title" "$R" '"error":"confirmation_mismatch"'
R=$(tool "$RWD" "$S3" delete_wireframe "{\"wireframeId\":$DUPID,\"confirmTitle\":\"Account settings copy\"}"); expect "delete token deletes with confirmation" "$R" '"deletedWireframeId"'
R=$(tool "$RWD" "$S3" get_wireframe "{\"wireframeId\":$DUPID}"); expect "deleted wireframe is gone" "$R" '"not_found"'
R=$(tool "$RWD" "$S3" delete_project "{\"projectId\":$NPID,\"confirmName\":\"MCP app\"}"); expect "project delete needs the exact name" "$R" 'confirmation_mismatch'
R=$(tool "$RWD" "$S3" delete_project "{\"projectId\":$NPID,\"confirmName\":\"MCP app v2\"}"); expect "project delete cascades" "$R" '"deletedWireframes":3'
R=$(tool "$RWD" "$S3" get_wireframe "{\"wireframeId\":$NWID}"); expect "cascaded wireframe is gone" "$R" '"not_found"'

# --- sessions never carry identity ---------------------------------------------------------
R=$(tool "$BOB" "$S" list_projects '{}'); refute "alice's session + bob's token acts as bob" "$R" 'Variant B'

# --- modern (stateless 2026-07-28) era -----------------------------------------------------
META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"mcp-smoke","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}'
R=$(curl -s -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H "Authorization: Bearer $RW" -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' -H 'Mcp-Name: list_projects' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"list_projects\",\"arguments\":{},$META}}" "$MCP")
expect "stateless era: tools/call without a session" "$R" 'My first project'

# --- revocation and expiry -----------------------------------------------------------------
TID=$(api_get alice mcp-tokens | python3 -c "import sys,json; print([t['id'] for t in json.load(sys.stdin)['tokens'] if t['prefix']=='${RO:0:12}'][0])")
R=$(api_post alice mcp-token-revoke "{\"id\":$TID}"); expect "revoke" "$R" '"ok":true'
R=$(rpc "$RO" "$S2" tools/list '{}' -w ' HTTP%{http_code}'); expect "revoked token → 401 immediately" "$R" 'HTTP401'
R=$(api_post bob mcp-token-revoke "{\"id\":$TID}"); expect "cannot revoke another user's token" "$R" '"not_found"'
sql 'UPDATE wf_mcp_tokens SET expires_at = ? WHERE token_hash = ?' '2000-01-01 00:00:00' "$(sha "$RWD")" > /dev/null
R=$(rpc "$RWD" "$S3" tools/list '{}' -w ' HTTP%{http_code}'); expect "expired token → 401" "$R" 'HTTP401'
expect "expired token flagged in the list" "$(api_get alice mcp-tokens)" '"expired":true'

# --- limits --------------------------------------------------------------------------------
python3 -c "print('{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{\"pad\":\"' + 'x'*4500000 + '\"}}')" > "$TMP/big.json"
R=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H "Authorization: Bearer $RW" --data-binary @"$TMP/big.json" "$MCP")
expect "oversized body → 413" "$R" '413'

# --- account deletion cascades to tokens ---------------------------------------------------
R=$(api_post bob delete-account "{\"password\":\"$PASSWORD\"}"); expect "delete account" "$R" '"ok":true'
R=$(rpc "$BOB" "" tools/list '{}' -w ' HTTP%{http_code}'); expect "deleted account's token → 401" "$R" 'HTTP401'
api_post alice delete-account "{\"password\":\"$PASSWORD\"}" > /dev/null

if [[ $FAILURES -gt 0 ]]; then echo "$FAILURES check(s) failed"; exit 1; fi
echo "all MCP checks passed"
