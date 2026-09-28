<?php
/**
 * Shared plumbing for the Wirefragma API: config, PDO, sessions, CSRF, JSON I/O, rate limits.
 * Plain PHP 7.4+ with PDO MySQL — no Composer, so it runs on any shared host.
 */

declare(strict_types=1);

/**
 * An expected failure with an HTTP status and a stable machine-readable code. `$extra` carries
 * additional response fields (e.g. `current` for a save conflict). Shared by the browser API and
 * the MCP endpoint, which maps the same codes onto tool errors.
 */
final class ApiError extends Exception
{
    public int $status;
    public string $errorCode;
    /** @var array<string, mixed> */
    public array $extra;

    public function __construct(int $status, string $errorCode, string $message, array $extra = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->extra = $extra;
    }
}

/** Largest wireframe document accepted, in bytes of JSON. */
const WF_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const WF_MIN_PASSWORD_LENGTH = 8;
const WF_SESSION_DAYS = 30;

function wf_config(): array
{
    static $config = null;
    if ($config !== null) return $config;

    $candidates = [];
    $env = getenv('WIREFRAGMA_CONFIG');
    if (is_string($env) && $env !== '') $candidates[] = $env;
    $candidates[] = dirname(__DIR__, 3) . '/wirefragma-config.php';
    $candidates[] = dirname(__DIR__) . '/config.php';

    foreach ($candidates as $path) {
        if (is_file($path)) {
            $loaded = require $path;
            if (!is_array($loaded)) break;
            $config = $loaded;
            return $config;
        }
    }
    throw new ApiError(503, 'not_configured', 'The Wirefragma server is not configured yet.');
}

function wf_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $db = wf_config()['db'] ?? [];
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $db['host'] ?? 'localhost',
        (int)($db['port'] ?? 3306),
        $db['name'] ?? ''
    );
    try {
        $pdo = new PDO($dsn, $db['user'] ?? '', $db['pass'] ?? '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    } catch (PDOException $error) {
        throw new ApiError(503, 'db_unavailable', 'The database is not reachable.');
    }
    return $pdo;
}

function wf_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function wf_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
    if (($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
    return strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function wf_client_ip(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function wf_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $lifetime = WF_SESSION_DAYS * 86400;
    ini_set('session.gc_maxlifetime', (string)$lifetime);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('wf_sid');
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path' => '/',
        'secure' => wf_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function wf_csrf_token(): string
{
    return (string)($_SESSION['csrf'] ?? '');
}

function wf_require_csrf(): void
{
    $sent = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($sent === '' || !hash_equals(wf_csrf_token(), $sent)) {
        throw new ApiError(403, 'csrf', 'Your session expired. Reload the page and try again.');
    }
}

/** Raw request body, size-checked, read once. */
function wf_raw_input(): string
{
    static $raw = null;
    if ($raw !== null) return $raw;
    $body = file_get_contents('php://input');
    $raw = $body === false ? '' : $body;
    if (strlen($raw) > WF_MAX_DOCUMENT_BYTES + 65536) {
        throw new ApiError(413, 'too_large', 'The request is too large.');
    }
    return $raw;
}

/** Decoded JSON request body (object) — empty array for GET. */
function wf_input(): array
{
    static $input = null;
    if ($input !== null) return $input;
    $raw = wf_raw_input();
    if ($raw === '') return $input = [];
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) throw new ApiError(400, 'bad_json', 'The request body is not valid JSON.');
    return $input = $decoded;
}

/**
 * One top-level field of the JSON body decoded with objects kept as `stdClass`.
 *
 * `json_decode(..., true)` cannot tell `{}` from `[]` (and turns `{"0": …}` into a list), so
 * re-encoding a document decoded that way would silently change it. Project documents are
 * therefore always taken from this object-preserving decode — unknown fields survive exactly.
 */
function wf_input_object_field(string $key)
{
    $raw = wf_raw_input();
    if ($raw === '') return null;
    $decoded = json_decode($raw, false);
    return is_object($decoded) && property_exists($decoded, $key) ? $decoded->{$key} : null;
}

function wf_str(array $input, string $key, int $maxLength = 1000): string
{
    $value = $input[$key] ?? '';
    if (!is_string($value)) return '';
    $value = trim($value);
    if (function_exists('mb_substr')) return mb_substr($value, 0, $maxLength);
    return substr($value, 0, $maxLength);
}

function wf_int(array $input, string $key): int
{
    $value = $input[$key] ?? ($_GET[$key] ?? 0);
    return is_numeric($value) ? (int)$value : 0;
}

function wf_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

/**
 * Fixed-window rate limit stored in MySQL (works on shared hosting without APCu/Redis).
 * Throws 429 when `$key` exceeded `$limit` hits in the current `$windowSeconds` window.
 */
function wf_rate_limit(string $action, string $key, int $limit, int $windowSeconds): void
{
    $bucket = hash('sha256', $action . '|' . $key);
    $now = time();
    $windowStart = $now - ($now % $windowSeconds);
    $db = wf_db();
    $db->prepare(
        'INSERT INTO wf_rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE hits = IF(window_start = VALUES(window_start), hits + 1, 1),
                                 window_start = VALUES(window_start)'
    )->execute([$bucket, $windowStart]);
    $statement = $db->prepare('SELECT hits FROM wf_rate_limits WHERE bucket = ?');
    $statement->execute([$bucket]);
    $hits = (int)$statement->fetchColumn();
    if ($hits > $limit) {
        throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
    }
    // Opportunistic cleanup of old windows (1% of requests).
    if (random_int(1, 100) === 1) {
        $db->prepare('DELETE FROM wf_rate_limits WHERE window_start < ?')->execute([$now - 86400]);
    }
}

function wf_current_user(): ?array
{
    $userId = (int)($_SESSION['user_id'] ?? 0);
    if ($userId <= 0) return null;
    $statement = wf_db()->prepare(
        'SELECT id, email, display_name, email_verified_at, created_at FROM wf_users WHERE id = ?'
    );
    $statement->execute([$userId]);
    $user = $statement->fetch();
    if (!$user || $user['email_verified_at'] === null) {
        unset($_SESSION['user_id']);
        return null;
    }
    return $user;
}

function wf_require_user(): array
{
    $user = wf_current_user();
    if (!$user) throw new ApiError(401, 'unauthorized', 'Please sign in.');
    return $user;
}

function wf_public_user(array $user): array
{
    return [
        'id' => (int)$user['id'],
        'email' => $user['email'],
        'displayName' => $user['display_name'],
        'createdAt' => $user['created_at'],
        'settings' => wf_user_settings((int)$user['id']),
    ];
}

const WF_LANGUAGES = ['en', 'ru', 'de', 'fr', 'es', 'sr', 'ja', 'zh'];
const WF_THEMES = ['light', 'dark', 'system'];

/** Created on demand so databases from the first release upgrade without a manual migration. */
function wf_ensure_settings_table(): void
{
    static $done = false;
    if ($done) return;
    wf_db()->exec(
        'CREATE TABLE IF NOT EXISTS wf_user_settings (
           user_id INT UNSIGNED NOT NULL, data TEXT NOT NULL, updated_at DATETIME NOT NULL,
           PRIMARY KEY (user_id),
           CONSTRAINT fk_wf_user_settings_user FOREIGN KEY (user_id) REFERENCES wf_users (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $done = true;
}

/** Interface preferences stored with the account, validated on the way out. */
function wf_user_settings(int $userId): array
{
    wf_ensure_settings_table();
    $statement = wf_db()->prepare('SELECT data FROM wf_user_settings WHERE user_id = ?');
    $statement->execute([$userId]);
    $data = json_decode((string)$statement->fetchColumn(), true);
    $settings = [];
    if (is_array($data)) {
        if (in_array($data['language'] ?? null, WF_LANGUAGES, true)) $settings['language'] = $data['language'];
        if (in_array($data['theme'] ?? null, WF_THEMES, true)) $settings['theme'] = $data['theme'];
    }
    return $settings;
}

function wf_normalize_email(string $email): string
{
    $email = strtolower(trim($email));
    return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
}

/** Random URL-safe token; only its sha256 is stored. */
function wf_new_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function wf_issue_email_token(int $userId, string $purpose, int $ttlSeconds): string
{
    $db = wf_db();
    // One live token per purpose: older links stop working when a new email is sent.
    $db->prepare('DELETE FROM wf_email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL')
        ->execute([$userId, $purpose]);
    $token = wf_new_token();
    $db->prepare(
        'INSERT INTO wf_email_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    )->execute([$userId, $purpose, hash('sha256', $token), gmdate('Y-m-d H:i:s', time() + $ttlSeconds), wf_now()]);
    return $token;
}

/** Consume a token: returns the user id, or null when unknown / used / expired. */
function wf_consume_email_token(string $token, string $purpose): ?int
{
    if ($token === '' || strlen($token) > 200) return null;
    $db = wf_db();
    $statement = $db->prepare(
        'SELECT id, user_id FROM wf_email_tokens
          WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?'
    );
    $statement->execute([hash('sha256', $token), $purpose, wf_now()]);
    $row = $statement->fetch();
    if (!$row) return null;
    $update = $db->prepare('UPDATE wf_email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL');
    $update->execute([wf_now(), $row['id']]);
    return $update->rowCount() === 1 ? (int)$row['user_id'] : null;
}

function wf_app_url(string $query = ''): string
{
    $base = (string)(wf_config()['app_url'] ?? '');
    if ($base === '') {
        $scheme = wf_is_https() ? 'https' : 'http';
        $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
        $dir = rtrim(dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'))), '/');
        $base = $scheme . '://' . $host . $dir . '/';
    }
    if (substr($base, -1) !== '/') $base .= '/';
    return $base . ($query !== '' ? '?' . $query : '');
}
