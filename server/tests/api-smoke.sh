#!/usr/bin/env bash
# End-to-end smoke test of the accounts API against a LOCAL server.
#
#   1. mysql -u USER -p DB < server/schema.sql
#   2. server/api/config.php with 'mail' => ['transport' => 'log', ...] and 'debug' => true
#   3. npm run dev:api            (php -S 127.0.0.1:8787 -t server)
#   4. server/tests/api-smoke.sh
#
# It reads the captcha answer from the PHP session file and the emailed links from mail.log,
# so it only works against the built-in PHP server on the same machine. Never run it in production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API="${API:-http://127.0.0.1:8787/api/index.php}"
MAIL_LOG="${MAIL_LOG:-$ROOT/server/mail.log}"
SESSIONS="$(php -r 'echo session_save_path() ?: sys_get_temp_dir();')"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
EMAIL="smoke$RANDOM$RANDOM@example.test"
FAILURES=0

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }
csrf() { curl -s -c "$JAR" -b "$JAR" "$API?action=status" | json '["csrf"]'; }
post() { curl -s -c "$JAR" -b "$JAR" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d "$2" "$API?action=$1"; }
captcha_answer() {
  curl -s -c "$JAR" -b "$JAR" "$API?action=captcha" > /dev/null
  local sid; sid=$(awk '$6=="wf_sid"{print $7}' "$JAR")
  php -r 'ini_set("session.save_path", sys_get_temp_dir()); @session_start(); session_decode(file_get_contents($argv[1])); echo $_SESSION["captcha"]["answer"];' "$SESSIONS/sess_$sid" 2>/dev/null
}
expect() { # name, haystack, needle
  if [[ "$2" == *"$3"* ]]; then echo "ok   $1"; else echo "FAIL $1: expected '$3' in: $2"; FAILURES=$((FAILURES + 1)); fi
}
last_link() { grep -o "$1=[A-Za-z0-9_-]*" "$MAIL_LOG" | tail -1 | cut -d= -f2; }

CSRF=$(csrf)
# Request bodies go into variables first: bash 3.2 (macOS) brace-expands JSON inside "$(...)".
R=$(curl -s -H 'Content-Type: application/json' -d '{}' "$API?action=login"); expect "csrf required" "$R" '"csrf"'

B=$(printf '{"email":"%s","password":"secret123","captcha":"NOPE","acceptPrivacy":true}' "$EMAIL")
R=$(post register "$B"); expect "wrong captcha" "$R" '"captcha"'
B=$(printf '{"email":"%s","password":"secret123","captcha":"%s","acceptPrivacy":true}' "$EMAIL" "$(captcha_answer)")
R=$(post register "$B"); expect "register" "$R" '"pending":true'
LOGIN=$(printf '{"email":"%s","password":"secret123"}' "$EMAIL")
R=$(post login "$LOGIN"); expect "login before verify" "$R" '"unverified"'
TOKEN=$(last_link verify)
B=$(printf '{"token":"%s"}' "$TOKEN")
R=$(post verify "$B"); expect "verify signs in" "$R" "\"email\":\"$EMAIL\""; CSRF=$(echo "$R" | json '["csrf"]')
R=$(post verify "$B"); expect "token single use" "$R" '"bad_token"'
P=$(curl -s -b "$JAR" "$API?action=projects"); expect "starter project" "$P" '"My first project"'
WID=$(echo "$P" | json '["projects"][0]["wireframes"][0]["id"]')
DOC='{"version":2,"title":"Home","canvas":{"width":400,"height":400},"layers":[],"elements":[]}'
B=$(printf '{"id":%s,"baseRevision":1,"data":%s}' "$WID" "$DOC")
R=$(post wireframe-save "$B"); expect "save" "$R" '"revision":2'
R=$(post wireframe-save "$B"); expect "stale save conflicts" "$R" '"conflict"'
B=$(printf '{"id":%s,"baseRevision":2,"data":{"x":1}}' "$WID")
R=$(post wireframe-save "$B"); expect "rejects non-projects" "$R" '"bad_document"'
R=$(post project-create '{"name":"Second"}'); expect "create project" "$R" '"Second"'
R=$(post logout '{}'); CSRF=$(echo "$R" | json '["csrf"]')
R=$(curl -s -b "$JAR" "$API?action=projects"); expect "signed out" "$R" '"unauthorized"'
B=$(printf '{"email":"%s","password":"nope-nope"}' "$EMAIL")
R=$(post login "$B"); expect "wrong password" "$R" '"bad_credentials"'
R=$(post login "$LOGIN"); expect "login" "$R" '"ok":true'; CSRF=$(echo "$R" | json '["csrf"]')
B=$(printf '{"email":"%s","captcha":"%s"}' "$EMAIL" "$(captcha_answer)")
R=$(post forgot "$B"); expect "forgot" "$R" '"ok":true'
B=$(printf '{"token":"%s","password":"newsecret456"}' "$(last_link reset)")
R=$(post reset "$B"); expect "reset" "$R" '"ok":true'; CSRF=$(echo "$R" | json '["csrf"]')
R=$(post delete-account '{"password":"secret123"}'); expect "delete needs password" "$R" '"bad_credentials"'
R=$(post delete-account '{"password":"newsecret456"}'); expect "delete account" "$R" '"ok":true'

if [[ $FAILURES -gt 0 ]]; then echo "$FAILURES check(s) failed"; exit 1; fi
echo "all API checks passed"
