<?php
/**
 * Personal MCP access tokens.
 *
 * A token lets an MCP client (a coding agent) act on the owner's projects without the browser
 * session: `Authorization: Bearer wf_mcp_…` on the MCP endpoint. Tokens are created and revoked
 * from the signed-in Settings dialog (browser API, session + CSRF + current password).
 *
 * Invariants:
 * - only SHA-256(raw token) is stored; the raw value is returned once, at creation, and never
 *   again (listing returns the display prefix only);
 * - a token grants exactly its scopes (`read`, `write`, `delete`); `write` never implies `delete`;
 * - revoked or expired tokens authenticate nothing, effective immediately;
 * - the token resolves to a user id, and every project query is then scoped by that id exactly
 *   as for a browser session (see lib/projects.php).
 *
 * The browser API never accepts these tokens, and the MCP endpoint never accepts sessions.
 * Swapping personal tokens for OAuth later only has to replace `wf_mcp_token_resolve`'s caller.
 */

declare(strict_types=1);

const WF_MCP_SCOPES = ['read', 'write', 'delete'];
const WF_MCP_DEFAULT_SCOPES = ['read', 'write'];
/** Offered lifetimes in days; null = never expires. */
const WF_MCP_EXPIRY_DAYS = [30, 90, 365, null];
const WF_MCP_TOKEN_PREFIX = 'wf_mcp_';
const WF_MCP_MAX_ACTIVE_TOKENS = 25;
const WF_MCP_TOKEN_NAME_MAX = 80;
/** `last_used_at` is refreshed at most this often, so a busy agent does not write on every call. */
const WF_MCP_LAST_USED_RESOLUTION = 60;

/** Created on demand (like wf_user_settings), so existing databases need no manual migration. */
function wf_ensure_mcp_tokens_table(): void
{
    static $done = false;
    if ($done) return;
    wf_db()->exec(
        'CREATE TABLE IF NOT EXISTS wf_mcp_tokens (
           id INT UNSIGNED NOT NULL AUTO_INCREMENT,
           user_id INT UNSIGNED NOT NULL,
           name VARCHAR(80) NOT NULL,
           token_hash CHAR(64) NOT NULL,
           token_prefix VARCHAR(16) NOT NULL,
           scopes VARCHAR(64) NOT NULL,
           created_at DATETIME NOT NULL,
           expires_at DATETIME NULL,
           last_used_at DATETIME NULL,
           revoked_at DATETIME NULL,
           PRIMARY KEY (id),
           UNIQUE KEY uq_wf_mcp_tokens_hash (token_hash),
           KEY ix_wf_mcp_tokens_user (user_id),
           CONSTRAINT fk_wf_mcp_tokens_user FOREIGN KEY (user_id) REFERENCES wf_users (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $done = true;
}

/** Known scopes only, canonical order; unknown values are dropped. */
function wf_mcp_normalize_scopes($scopes): array
{
    if (is_string($scopes)) $scopes = preg_split('/[\s,]+/', $scopes) ?: [];
    if (!is_array($scopes)) return [];
    return array_values(array_filter(WF_MCP_SCOPES, static fn(string $scope): bool => in_array($scope, $scopes, true)));
}

/** Row → what the browser may see. Never the hash, never the secret. */
function wf_mcp_token_public(array $row): array
{
    $expires = $row['expires_at'];
    return [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'prefix' => $row['token_prefix'],
        'scopes' => wf_mcp_normalize_scopes((string)$row['scopes']),
        'createdAt' => $row['created_at'],
        'expiresAt' => $expires,
        'lastUsedAt' => $row['last_used_at'],
        'expired' => $expires !== null && $expires <= wf_now(),
    ];
}

/** The user's tokens that have not been revoked (expired ones included, flagged), newest first. */
function wf_mcp_tokens_list(int $userId): array
{
    wf_ensure_mcp_tokens_table();
    $statement = wf_db()->prepare(
        'SELECT id, name, token_prefix, scopes, created_at, expires_at, last_used_at
           FROM wf_mcp_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC'
    );
    $statement->execute([$userId]);
    return array_map('wf_mcp_token_public', $statement->fetchAll());
}

/**
 * Create a token. Returns the raw secret — the only time it exists outside the client.
 *
 * @param int|null $expiresInDays one of WF_MCP_EXPIRY_DAYS
 * @return array{token: string, record: array}
 */
function wf_mcp_token_create(int $userId, string $name, array $scopes, ?int $expiresInDays): array
{
    wf_ensure_mcp_tokens_table();
    $name = wf_clean_name($name, WF_MCP_TOKEN_NAME_MAX);
    if ($name === '') throw new ApiError(400, 'bad_name', 'Give the token a name, e.g. the agent that will use it.');
    $scopes = wf_mcp_normalize_scopes($scopes);
    if (!in_array('read', $scopes, true)) {
        throw new ApiError(400, 'bad_scopes', 'A token needs at least the read permission.');
    }
    if (!in_array($expiresInDays, WF_MCP_EXPIRY_DAYS, true)) {
        throw new ApiError(400, 'bad_expiry', 'Choose one of the offered expiration periods.');
    }

    $db = wf_db();
    $count = $db->prepare(
        'SELECT COUNT(*) FROM wf_mcp_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'
    );
    $count->execute([$userId, wf_now()]);
    if ((int)$count->fetchColumn() >= WF_MCP_MAX_ACTIVE_TOKENS) {
        throw new ApiError(400, 'too_many_tokens', 'You have too many active MCP tokens. Revoke one you no longer use.');
    }

    $secret = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $token = WF_MCP_TOKEN_PREFIX . $secret;
    $now = wf_now();
    $db->prepare(
        'INSERT INTO wf_mcp_tokens (user_id, name, token_hash, token_prefix, scopes, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $userId,
        $name,
        hash('sha256', $token),
        substr($token, 0, strlen(WF_MCP_TOKEN_PREFIX) + 5),
        implode(' ', $scopes),
        $now,
        $expiresInDays === null ? null : gmdate('Y-m-d H:i:s', time() + $expiresInDays * 86400),
    ]);
    $id = (int)$db->lastInsertId();
    $row = $db->prepare('SELECT id, name, token_prefix, scopes, created_at, expires_at, last_used_at FROM wf_mcp_tokens WHERE id = ?');
    $row->execute([$id]);
    return ['token' => $token, 'record' => wf_mcp_token_public($row->fetch())];
}

/** Revoke one of the user's tokens. Takes effect on the very next MCP request. */
function wf_mcp_token_revoke(int $userId, int $tokenId): void
{
    wf_ensure_mcp_tokens_table();
    $statement = wf_db()->prepare('UPDATE wf_mcp_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL');
    $statement->execute([wf_now(), $tokenId, $userId]);
    if ($statement->rowCount() === 0) throw new ApiError(404, 'not_found', 'That token does not exist.');
}

/**
 * Resolve a raw bearer token to its owner and scopes, or null when it is malformed, unknown,
 * revoked, expired, or belongs to an account that is gone / unverified. Constant format check
 * first, so garbage never reaches the database.
 *
 * @return array{tokenId: int, userId: int, scopes: list<string>}|null
 */
function wf_mcp_token_resolve(string $token): ?array
{
    if (!preg_match('/^wf_mcp_[A-Za-z0-9_-]{43}$/', $token)) return null;
    wf_ensure_mcp_tokens_table();
    $now = wf_now();
    $statement = wf_db()->prepare(
        'SELECT t.id, t.user_id, t.scopes, t.last_used_at
           FROM wf_mcp_tokens t JOIN wf_users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)
            AND u.email_verified_at IS NOT NULL'
    );
    $statement->execute([hash('sha256', $token), $now]);
    $row = $statement->fetch();
    if (!$row) return null;

    $lastUsed = $row['last_used_at'] === null ? 0 : (int)strtotime($row['last_used_at'] . ' UTC');
    if (time() - $lastUsed >= WF_MCP_LAST_USED_RESOLUTION) {
        wf_db()->prepare('UPDATE wf_mcp_tokens SET last_used_at = ? WHERE id = ?')->execute([$now, $row['id']]);
    }
    return [
        'tokenId' => (int)$row['id'],
        'userId' => (int)$row['user_id'],
        'scopes' => wf_mcp_normalize_scopes((string)$row['scopes']),
    ];
}
