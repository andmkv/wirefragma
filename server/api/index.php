<?php
/**
 * Wirefragma API — a single front controller: index.php?action=<name>.
 *
 * Query-string routing needs no mod_rewrite, so it works on any shared host. GET actions only
 * read; every POST requires the session CSRF token in the X-CSRF-Token header.
 */

declare(strict_types=1);

// Warnings must never leak into JSON responses; they still reach the server error log.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/captcha.php';
require __DIR__ . '/lib/mail.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

const WF_VERIFY_TTL = 48 * 3600;
const WF_RESET_TTL = 3600;

$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    wf_config();
    wf_start_session();

    // Email links land on the app (?verify= / ?reset=); this endpoint is only for API calls.
    $getActions = ['status', 'captcha', 'projects', 'wireframe'];
    if ($method === 'GET' && !in_array($action, $getActions, true)) {
        throw new ApiError(405, 'method', 'Use POST for this action.');
    }
    if ($method === 'POST') {
        wf_require_csrf();
    } elseif ($method !== 'GET') {
        throw new ApiError(405, 'method', 'Method not allowed.');
    }

    switch ($action) {
        case 'status':
            wf_json(action_status());
            break;
        case 'captcha':
            wf_rate_limit('captcha', wf_client_ip(), 60, 600);
            wf_json(wf_captcha_new());
            break;
        case 'register':
            wf_json(action_register(wf_input()));
            break;
        case 'verify':
            wf_json(action_verify(wf_input()));
            break;
        case 'resend':
            wf_json(action_resend(wf_input()));
            break;
        case 'login':
            wf_json(action_login(wf_input()));
            break;
        case 'logout':
            $_SESSION = ['csrf' => bin2hex(random_bytes(32))];
            session_regenerate_id(true);
            wf_json(['ok' => true, 'csrf' => wf_csrf_token()]);
            break;
        case 'forgot':
            wf_json(action_forgot(wf_input()));
            break;
        case 'reset':
            wf_json(action_reset(wf_input()));
            break;
        case 'delete-account':
            wf_json(action_delete_account(wf_input()));
            break;
        case 'settings-save':
            wf_json(action_settings_save(wf_input()));
            break;
        case 'password-change':
            wf_json(action_password_change(wf_input()));
            break;
        case 'projects':
            wf_json(['projects' => projects_tree((int)wf_require_user()['id'])]);
            break;
        case 'project-create':
            wf_json(action_project_create(wf_input()));
            break;
        case 'project-rename':
            wf_json(action_project_rename(wf_input()));
            break;
        case 'project-delete':
            wf_json(action_project_delete(wf_input()));
            break;
        case 'wireframe':
            wf_json(action_wireframe_get());
            break;
        case 'wireframe-create':
            wf_json(action_wireframe_create(wf_input()));
            break;
        case 'wireframe-save':
            wf_json(action_wireframe_save(wf_input()));
            break;
        case 'wireframe-rename':
            wf_json(action_wireframe_rename(wf_input()));
            break;
        case 'wireframe-duplicate':
            wf_json(action_wireframe_duplicate(wf_input()));
            break;
        case 'wireframe-delete':
            wf_json(action_wireframe_delete(wf_input()));
            break;
        default:
            throw new ApiError(404, 'unknown_action', 'Unknown action.');
    }
} catch (ApiError $error) {
    $payload = ['error' => $error->errorCode, 'message' => $error->getMessage()];
    if ($error->errorCode === 'conflict' && isset($GLOBALS['wf_conflict'])) $payload['current'] = $GLOBALS['wf_conflict'];
    wf_json($payload, $error->status);
} catch (Throwable $error) {
    error_log('[wirefragma] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
    $payload = ['error' => 'server', 'message' => 'Something went wrong on the server.'];
    try {
        if (!empty(wf_config()['debug'])) $payload['debug'] = $error->getMessage();
    } catch (Throwable $ignored) {
    }
    wf_json($payload, 500);
}

/* ------------------------------------------------------------------ account */

function action_status(): array
{
    $config = wf_config();
    $user = null;
    try {
        $user = wf_current_user();
    } catch (ApiError $error) {
        // Configured but DB down: report it so the client can fall back to guest mode.
        return ['enabled' => false, 'reason' => $error->errorCode];
    }
    $privacy = $config['privacy'] ?? [];
    return [
        'enabled' => true,
        'user' => $user ? wf_public_user($user) : null,
        'csrf' => wf_csrf_token(),
        'captcha' => wf_captcha_public(),
        'registrationOpen' => ($config['registration_open'] ?? true) !== false,
        'privacy' => [
            'version' => (string)($privacy['version'] ?? '1'),
            'operator' => (string)($privacy['operator'] ?? 'Wirefragma'),
            'contactEmail' => (string)($privacy['contact_email'] ?? ''),
        ],
    ];
}

function validate_password(string $password): void
{
    $length = function_exists('mb_strlen') ? mb_strlen($password) : strlen($password);
    if ($length < WF_MIN_PASSWORD_LENGTH) {
        throw new ApiError(400, 'weak_password', 'Use at least ' . WF_MIN_PASSWORD_LENGTH . ' characters for the password.');
    }
    if ($length > 200) throw new ApiError(400, 'weak_password', 'That password is too long.');
}

function action_register(array $input): array
{
    $config = wf_config();
    if (($config['registration_open'] ?? true) === false) {
        throw new ApiError(403, 'closed', 'New registrations are currently closed.');
    }
    wf_rate_limit('register', wf_client_ip(), 8, 3600);

    // Honeypot: real users never see or fill this field.
    if (wf_str($input, 'website') !== '') return ['ok' => true, 'pending' => true];

    wf_captcha_verify($input);

    $email = wf_normalize_email(wf_str($input, 'email', 191));
    if ($email === '') throw new ApiError(400, 'bad_email', 'Enter a valid email address.');
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    validate_password($password);
    if (($input['acceptPrivacy'] ?? false) !== true) {
        throw new ApiError(400, 'privacy', 'Please accept the privacy policy to create an account.');
    }
    $displayName = wf_str($input, 'displayName', 80);

    $db = wf_db();
    $statement = $db->prepare('SELECT id, email_verified_at FROM wf_users WHERE email = ?');
    $statement->execute([$email]);
    $existing = $statement->fetch();

    // Same answer whether or not the address is taken, so the form cannot be used to probe
    // which emails have accounts. The mailbox owner learns what happened from the email.
    if ($existing) {
        if ($existing['email_verified_at'] === null) {
            wf_mail_verify($email, wf_issue_email_token((int)$existing['id'], 'verify', WF_VERIFY_TTL));
        } else {
            wf_mail_already_registered($email);
        }
        return ['ok' => true, 'pending' => true];
    }

    $now = wf_now();
    $db->prepare(
        'INSERT INTO wf_users (email, password_hash, display_name, privacy_version, privacy_accepted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $email,
        password_hash($password, PASSWORD_DEFAULT),
        $displayName,
        (string)($config['privacy']['version'] ?? '1'),
        $now,
        $now,
        $now,
    ]);
    $userId = (int)$db->lastInsertId();
    $sent = wf_mail_verify($email, wf_issue_email_token($userId, 'verify', WF_VERIFY_TTL));
    return ['ok' => true, 'pending' => true, 'mailSent' => $sent];
}

function action_verify(array $input): array
{
    wf_rate_limit('verify', wf_client_ip(), 30, 3600);
    $userId = wf_consume_email_token(wf_str($input, 'token', 200), 'verify');
    if ($userId === null) {
        throw new ApiError(400, 'bad_token', 'This confirmation link is invalid or has expired. Sign in to get a new one.');
    }
    $db = wf_db();
    $db->prepare('UPDATE wf_users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?')
        ->execute([wf_now(), wf_now(), $userId]);
    ensure_starter_project($userId, $input);
    return login_session($userId);
}

function action_resend(array $input): array
{
    wf_rate_limit('resend', wf_client_ip(), 5, 3600);
    $email = wf_normalize_email(wf_str($input, 'email', 191));
    if ($email !== '') {
        wf_rate_limit('resend-email', $email, 3, 3600);
        $statement = wf_db()->prepare('SELECT id FROM wf_users WHERE email = ? AND email_verified_at IS NULL');
        $statement->execute([$email]);
        $userId = $statement->fetchColumn();
        if ($userId) wf_mail_verify($email, wf_issue_email_token((int)$userId, 'verify', WF_VERIFY_TTL));
    }
    return ['ok' => true];
}

function action_login(array $input): array
{
    $email = wf_normalize_email(wf_str($input, 'email', 191));
    wf_rate_limit('login', wf_client_ip(), 30, 900);
    if ($email !== '') wf_rate_limit('login-email', $email, 10, 900);
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';

    $statement = wf_db()->prepare('SELECT id, password_hash, email_verified_at FROM wf_users WHERE email = ?');
    $statement->execute([$email]);
    $user = $statement->fetch();
    // Always run a hash check so response time does not reveal whether the email exists.
    $hash = $user ? $user['password_hash'] : '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG';
    $valid = password_verify($password, $hash);
    if (!$user || !$valid) throw new ApiError(401, 'bad_credentials', 'Wrong email or password.');
    if ($user['email_verified_at'] === null) {
        throw new ApiError(403, 'unverified', 'Please confirm your email first — check your inbox for the link.');
    }
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        wf_db()->prepare('UPDATE wf_users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }
    return login_session((int)$user['id']);
}

function login_session(int $userId): array
{
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    wf_db()->prepare('UPDATE wf_users SET last_login_at = ? WHERE id = ?')->execute([wf_now(), $userId]);
    $user = wf_current_user();
    return ['ok' => true, 'user' => $user ? wf_public_user($user) : null, 'csrf' => wf_csrf_token()];
}

function action_forgot(array $input): array
{
    wf_rate_limit('forgot', wf_client_ip(), 6, 3600);
    wf_captcha_verify($input);
    $email = wf_normalize_email(wf_str($input, 'email', 191));
    if ($email !== '') {
        wf_rate_limit('forgot-email', $email, 3, 3600);
        $statement = wf_db()->prepare('SELECT id FROM wf_users WHERE email = ?');
        $statement->execute([$email]);
        $userId = $statement->fetchColumn();
        if ($userId) wf_mail_reset($email, wf_issue_email_token((int)$userId, 'reset', WF_RESET_TTL));
    }
    return ['ok' => true];
}

function action_reset(array $input): array
{
    wf_rate_limit('reset', wf_client_ip(), 20, 3600);
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    validate_password($password);
    $userId = wf_consume_email_token(wf_str($input, 'token', 200), 'reset');
    if ($userId === null) throw new ApiError(400, 'bad_token', 'This reset link is invalid or has expired. Request a new one.');
    $now = wf_now();
    // Resetting through the emailed link also proves ownership of the address.
    wf_db()->prepare(
        'UPDATE wf_users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?'
    )->execute([password_hash($password, PASSWORD_DEFAULT), $now, $now, $userId]);
    ensure_starter_project($userId, $input);
    return login_session($userId);
}

function action_delete_account(array $input): array
{
    $user = wf_require_user();
    $password = is_string($input['password'] ?? null) ? $input['password'] : '';
    $statement = wf_db()->prepare('SELECT password_hash FROM wf_users WHERE id = ?');
    $statement->execute([$user['id']]);
    if (!password_verify($password, (string)$statement->fetchColumn())) {
        throw new ApiError(403, 'bad_credentials', 'The password is not correct.');
    }
    // Foreign keys cascade to projects, wireframes and tokens.
    wf_db()->prepare('DELETE FROM wf_users WHERE id = ?')->execute([$user['id']]);
    $_SESSION = ['csrf' => bin2hex(random_bytes(32))];
    session_regenerate_id(true);
    return ['ok' => true, 'csrf' => wf_csrf_token()];
}

/** Profile + interface preferences. Every field is optional; unknown values are ignored. */
function action_settings_save(array $input): array
{
    $user = wf_require_user();
    $userId = (int)$user['id'];
    wf_rate_limit('settings', (string)$userId, 300, 3600);
    if (array_key_exists('displayName', $input)) {
        wf_db()->prepare('UPDATE wf_users SET display_name = ?, updated_at = ? WHERE id = ?')
            ->execute([wf_str($input, 'displayName', 80), wf_now(), $userId]);
    }
    $settings = wf_user_settings($userId);
    if (in_array($input['language'] ?? null, WF_LANGUAGES, true)) $settings['language'] = $input['language'];
    if (in_array($input['theme'] ?? null, WF_THEMES, true)) $settings['theme'] = $input['theme'];
    wf_db()->prepare(
        'INSERT INTO wf_user_settings (user_id, data, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)'
    )->execute([$userId, json_encode($settings), wf_now()]);
    $fresh = wf_current_user();
    return ['ok' => true, 'user' => $fresh ? wf_public_user($fresh) : null];
}

function action_password_change(array $input): array
{
    $user = wf_require_user();
    wf_rate_limit('password-change', (string)$user['id'], 10, 3600);
    $current = is_string($input['current'] ?? null) ? $input['current'] : '';
    $next = is_string($input['next'] ?? null) ? $input['next'] : '';
    $statement = wf_db()->prepare('SELECT password_hash FROM wf_users WHERE id = ?');
    $statement->execute([$user['id']]);
    if (!password_verify($current, (string)$statement->fetchColumn())) {
        throw new ApiError(403, 'bad_credentials', 'The current password is not correct.');
    }
    validate_password($next);
    wf_db()->prepare('UPDATE wf_users SET password_hash = ?, updated_at = ? WHERE id = ?')
        ->execute([password_hash($next, PASSWORD_DEFAULT), wf_now(), $user['id']]);
    // Other reset links stop working once the password is changed deliberately.
    wf_db()->prepare("DELETE FROM wf_email_tokens WHERE user_id = ? AND purpose = 'reset'")->execute([$user['id']]);
    session_regenerate_id(true);
    return ['ok' => true, 'csrf' => wf_csrf_token()];
}

/* ------------------------------------------------------------------ projects */

function projects_tree(int $userId): array
{
    $db = wf_db();
    $projects = $db->prepare('SELECT id, name, updated_at FROM wf_projects WHERE user_id = ? ORDER BY position, id');
    $projects->execute([$userId]);
    $wireframes = $db->prepare(
        'SELECT id, project_id, title, revision, updated_at FROM wf_wireframes WHERE user_id = ? ORDER BY position, id'
    );
    $wireframes->execute([$userId]);

    $byProject = [];
    foreach ($wireframes->fetchAll() as $row) {
        $byProject[(int)$row['project_id']][] = [
            'id' => (int)$row['id'],
            'title' => $row['title'],
            'revision' => (int)$row['revision'],
            'updatedAt' => $row['updated_at'],
        ];
    }
    $result = [];
    foreach ($projects->fetchAll() as $row) {
        $result[] = [
            'id' => (int)$row['id'],
            'name' => $row['name'],
            'updatedAt' => $row['updated_at'],
            'wireframes' => $byProject[(int)$row['id']] ?? [],
        ];
    }
    return $result;
}

function owned_project(int $userId, int $projectId): array
{
    $statement = wf_db()->prepare('SELECT id, name FROM wf_projects WHERE id = ? AND user_id = ?');
    $statement->execute([$projectId, $userId]);
    $project = $statement->fetch();
    if (!$project) throw new ApiError(404, 'not_found', 'That project does not exist.');
    return $project;
}

function owned_wireframe(int $userId, int $wireframeId): array
{
    $statement = wf_db()->prepare(
        'SELECT id, project_id, title, data, revision, updated_at FROM wf_wireframes WHERE id = ? AND user_id = ?'
    );
    $statement->execute([$wireframeId, $userId]);
    $wireframe = $statement->fetch();
    if (!$wireframe) throw new ApiError(404, 'not_found', 'That wireframe does not exist.');
    return $wireframe;
}

function required_name(array $input, string $key, int $max, string $what): string
{
    $name = wf_str($input, $key, $max);
    if ($name === '') throw new ApiError(400, 'bad_name', "Give the {$what} a name.");
    return $name;
}

/** Validate an incoming project document: a JSON object with an elements array, size-capped. */
function document_json($data): string
{
    if (!is_array($data) || !isset($data['elements']) || !is_array($data['elements'])) {
        throw new ApiError(400, 'bad_document', 'The wireframe data is not a Wirefragma project.');
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new ApiError(400, 'bad_document', 'The wireframe data could not be encoded.');
    if (strlen($json) > WF_MAX_DOCUMENT_BYTES) {
        throw new ApiError(413, 'too_large', 'This wireframe is larger than 2 MB and cannot be saved.');
    }
    return $json;
}

function blank_document(string $title): array
{
    return [
        'version' => 2,
        'title' => $title,
        'canvas' => ['mode' => 'desktop', 'width' => 1200, 'height' => 800],
        'layers' => [['id' => 'layer_' . bin2hex(random_bytes(4)), 'name' => 'Default', 'visible' => true, 'locked' => false]],
        'elements' => [],
    ];
}

function next_position(string $table, string $column, int $value): int
{
    $statement = wf_db()->prepare("SELECT COALESCE(MAX(position), -1) + 1 FROM {$table} WHERE {$column} = ?");
    $statement->execute([$value]);
    return (int)$statement->fetchColumn();
}

function insert_wireframe(int $userId, int $projectId, string $title, string $json): int
{
    $now = wf_now();
    wf_db()->prepare(
        'INSERT INTO wf_wireframes (project_id, user_id, title, data, revision, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
    )->execute([$projectId, $userId, $title, $json, next_position('wf_wireframes', 'project_id', $projectId), $now, $now]);
    $id = (int)wf_db()->lastInsertId();
    touch_project($projectId);
    return $id;
}

function touch_project(int $projectId): void
{
    wf_db()->prepare('UPDATE wf_projects SET updated_at = ? WHERE id = ?')->execute([wf_now(), $projectId]);
}

/**
 * First sign-in gets one project with one blank wireframe, so the editor never opens empty. The
 * client sends the names in the user's language (`starter.project`, `starter.wireframe`).
 */
function ensure_starter_project(int $userId, array $input = []): void
{
    $statement = wf_db()->prepare('SELECT COUNT(*) FROM wf_projects WHERE user_id = ?');
    $statement->execute([$userId]);
    if ((int)$statement->fetchColumn() > 0) return;
    $starter = is_array($input['starter'] ?? null) ? $input['starter'] : [];
    $projectName = wf_str($starter, 'project', 120) ?: 'My first project';
    $wireframeTitle = wf_str($starter, 'wireframe', 160) ?: 'Home screen';
    $now = wf_now();
    wf_db()->prepare('INSERT INTO wf_projects (user_id, name, position, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        ->execute([$userId, $projectName, $now, $now]);
    $projectId = (int)wf_db()->lastInsertId();
    insert_wireframe($userId, $projectId, $wireframeTitle, document_json(blank_document($wireframeTitle)));
}

function action_project_create(array $input): array
{
    $user = wf_require_user();
    $userId = (int)$user['id'];
    wf_rate_limit('project-create', (string)$userId, 120, 3600);
    $name = required_name($input, 'name', 120, 'project');
    $now = wf_now();
    wf_db()->prepare('INSERT INTO wf_projects (user_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$userId, $name, next_position('wf_projects', 'user_id', $userId), $now, $now]);
    $projectId = (int)wf_db()->lastInsertId();
    $wireframeId = null;
    if (($input['withWireframe'] ?? true) !== false) {
        $title = wf_str($input, 'wireframeTitle', 160) ?: 'Screen 1';
        $wireframeId = insert_wireframe($userId, $projectId, $title, document_json(blank_document($title)));
    }
    return ['ok' => true, 'projectId' => $projectId, 'wireframeId' => $wireframeId, 'projects' => projects_tree($userId)];
}

function action_project_rename(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    $project = owned_project($userId, wf_int($input, 'id'));
    $name = required_name($input, 'name', 120, 'project');
    wf_db()->prepare('UPDATE wf_projects SET name = ?, updated_at = ? WHERE id = ?')->execute([$name, wf_now(), $project['id']]);
    return ['ok' => true, 'projects' => projects_tree($userId)];
}

function action_project_delete(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    $project = owned_project($userId, wf_int($input, 'id'));
    wf_db()->prepare('DELETE FROM wf_projects WHERE id = ?')->execute([$project['id']]);
    return ['ok' => true, 'projects' => projects_tree($userId)];
}

function wireframe_payload(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'projectId' => (int)$row['project_id'],
        'title' => $row['title'],
        'revision' => (int)$row['revision'],
        'updatedAt' => $row['updated_at'],
        'data' => json_decode((string)$row['data'], true),
    ];
}

function action_wireframe_get(): array
{
    $userId = (int)wf_require_user()['id'];
    return ['wireframe' => wireframe_payload(owned_wireframe($userId, wf_int([], 'id')))];
}

function action_wireframe_create(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    wf_rate_limit('wireframe-create', (string)$userId, 300, 3600);
    $project = owned_project($userId, wf_int($input, 'projectId'));
    $title = required_name($input, 'title', 160, 'wireframe');
    $json = isset($input['data']) ? document_json($input['data']) : document_json(blank_document($title));
    $id = insert_wireframe($userId, (int)$project['id'], $title, $json);
    return ['ok' => true, 'wireframeId' => $id, 'projects' => projects_tree($userId)];
}

/**
 * Save with optimistic concurrency: the client sends the revision it started from. A mismatch
 * means another tab/device saved in between; the client gets 409 with the current server copy.
 */
function action_wireframe_save(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    wf_rate_limit('wireframe-save', (string)$userId, 1200, 3600);
    $wireframe = owned_wireframe($userId, wf_int($input, 'id'));
    $json = document_json($input['data'] ?? null);
    $title = wf_str($input, 'title', 160);
    if ($title === '') $title = (string)$wireframe['title'];
    $base = wf_int($input, 'baseRevision');
    $force = ($input['force'] ?? false) === true;

    $statement = wf_db()->prepare(
        'UPDATE wf_wireframes SET data = ?, title = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND user_id = ?' . ($force ? '' : ' AND revision = ?')
    );
    $params = [$json, $title, wf_now(), $wireframe['id'], $userId];
    if (!$force) $params[] = $base;
    $statement->execute($params);
    if ($statement->rowCount() === 0) {
        $GLOBALS['wf_conflict'] = wireframe_payload(owned_wireframe($userId, (int)$wireframe['id']));
        throw new ApiError(409, 'conflict', 'This wireframe was changed in another tab or on another device.');
    }
    touch_project((int)$wireframe['project_id']);
    return ['ok' => true, 'revision' => $force ? (int)$wireframe['revision'] + 1 : $base + 1, 'title' => $title];
}

function action_wireframe_rename(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    $wireframe = owned_wireframe($userId, wf_int($input, 'id'));
    $title = required_name($input, 'title', 160, 'wireframe');
    // The title also lives inside the document; keep both in sync.
    $data = json_decode((string)$wireframe['data'], true);
    if (is_array($data)) $data['title'] = $title;
    wf_db()->prepare('UPDATE wf_wireframes SET title = ?, data = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        ->execute([$title, document_json($data), wf_now(), $wireframe['id']]);
    return ['ok' => true, 'revision' => (int)$wireframe['revision'] + 1, 'projects' => projects_tree($userId)];
}

function action_wireframe_duplicate(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    $wireframe = owned_wireframe($userId, wf_int($input, 'id'));
    $title = wf_str(['t' => $wireframe['title'] . ' copy'], 't', 160);
    $data = json_decode((string)$wireframe['data'], true);
    if (is_array($data)) $data['title'] = $title;
    $id = insert_wireframe($userId, (int)$wireframe['project_id'], $title, document_json($data));
    return ['ok' => true, 'wireframeId' => $id, 'projects' => projects_tree($userId)];
}

function action_wireframe_delete(array $input): array
{
    $userId = (int)wf_require_user()['id'];
    $wireframe = owned_wireframe($userId, wf_int($input, 'id'));
    wf_db()->prepare('DELETE FROM wf_wireframes WHERE id = ?')->execute([$wireframe['id']]);
    touch_project((int)$wireframe['project_id']);
    return ['ok' => true, 'projects' => projects_tree($userId)];
}
