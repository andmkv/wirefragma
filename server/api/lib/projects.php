<?php
/**
 * Projects and wireframes — the one persistence layer behind every client of an account.
 *
 * The browser API (`api/index.php`, session + CSRF) and the MCP endpoint (`mcp/index.php`, bearer
 * token) both call these functions; neither talks to `wf_projects` / `wf_wireframes` directly.
 * That keeps ownership checks, name limits, blank documents, positions, revision handling and
 * title synchronisation identical for a human in the editor and an agent over MCP.
 *
 * Every function takes the authenticated user id and scopes every query by it. Failures are
 * `ApiError`s with stable codes (`not_found`, `bad_name`, `bad_document`, `too_large`,
 * `conflict`), which each front end maps onto its own response format.
 *
 * Documents are the canonical `WireframeProject` JSON (the `ui-project` block). The server never
 * interprets them beyond "a JSON object with an `elements` array": it stores what it is given,
 * byte-for-byte modulo JSON formatting. They are handled as `stdClass` trees (see
 * `wf_input_object_field`) so `{}` stays `{}` and unknown fields survive a read-modify-write.
 */

declare(strict_types=1);

const WF_PROJECT_NAME_MAX = 120;
const WF_WIREFRAME_TITLE_MAX = 160;

/* ------------------------------------------------------------------ names */

/** Trimmed, length-capped string ('' for anything that is not a string). */
function wf_clean_name($value, int $max): string
{
    if (!is_string($value)) return '';
    $value = trim($value);
    return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

function wf_require_name($value, int $max, string $what): string
{
    $name = wf_clean_name($value, $max);
    if ($name === '') throw new ApiError(400, 'bad_name', "Give the {$what} a name.");
    return $name;
}

/* -------------------------------------------------------------- documents */

/** True for a decoded JSON object (stdClass, or an associative PHP array from assoc decoding). */
function wf_is_json_object($value): bool
{
    if ($value instanceof stdClass) return true;
    if (!is_array($value)) return false;
    return $value === [] ? false : array_keys($value) !== range(0, count($value) - 1);
}

function wf_document_field($document, string $key)
{
    if ($document instanceof stdClass) return property_exists($document, $key) ? $document->{$key} : null;
    return is_array($document) ? ($document[$key] ?? null) : null;
}

/** The same document with `title` replaced (the stored title and the document title stay in sync). */
function wf_document_with_title($document, string $title)
{
    if ($document instanceof stdClass) {
        $copy = clone $document;
        $copy->title = $title;
        return $copy;
    }
    if (is_array($document)) $document['title'] = $title;
    return $document;
}

/**
 * Validate an incoming project document and encode it for storage: a JSON object with an
 * `elements` array, at most WF_MAX_DOCUMENT_BYTES. Deliberately shallow — the client runs
 * `normalizeProject` on everything it loads, and MCP input is additionally checked against the
 * generated JSON Schema before it gets here.
 */
function wf_document_json($document): string
{
    if (!wf_is_json_object($document) || !is_array(wf_document_field($document, 'elements'))) {
        throw new ApiError(400, 'bad_document', 'The wireframe data is not a Wirefragma project (a JSON object with an "elements" array).');
    }
    $json = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    if ($json === false) throw new ApiError(400, 'bad_document', 'The wireframe data could not be encoded as JSON.');
    if (strlen($json) > WF_MAX_DOCUMENT_BYTES) {
        throw new ApiError(413, 'too_large', 'This wireframe is larger than 2 MB and cannot be saved.');
    }
    return $json;
}

/** Stored JSON → document tree, objects kept as stdClass (null if the row is corrupt). */
function wf_document_decode(string $json)
{
    $decoded = json_decode($json, false);
    return $decoded instanceof stdClass ? $decoded : null;
}

/** The empty document the editor would create: one layer, no elements (format version 2). */
function wf_blank_document(string $title): array
{
    return [
        'version' => 2,
        'title' => $title,
        'canvas' => ['mode' => 'desktop', 'width' => 1200, 'height' => 800],
        'layers' => [['id' => 'layer_' . bin2hex(random_bytes(4)), 'name' => 'Default', 'visible' => true, 'locked' => false]],
        'elements' => [],
    ];
}

/* ----------------------------------------------------------------- reads */

/** Every project of the user with wireframe summaries (metadata only, never documents). */
function wf_projects_tree(int $userId): array
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

function wf_owned_project(int $userId, int $projectId): array
{
    $statement = wf_db()->prepare('SELECT id, name, updated_at FROM wf_projects WHERE id = ? AND user_id = ?');
    $statement->execute([$projectId, $userId]);
    $project = $statement->fetch();
    if (!$project) throw new ApiError(404, 'not_found', 'That project does not exist.');
    return $project;
}

function wf_owned_wireframe(int $userId, int $wireframeId): array
{
    $statement = wf_db()->prepare(
        'SELECT id, project_id, title, data, revision, updated_at FROM wf_wireframes WHERE id = ? AND user_id = ?'
    );
    $statement->execute([$wireframeId, $userId]);
    $wireframe = $statement->fetch();
    if (!$wireframe) throw new ApiError(404, 'not_found', 'That wireframe does not exist.');
    return $wireframe;
}

/** Wireframe row → API shape. `data` is the stored document, unmodified. */
function wf_wireframe_payload(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'projectId' => (int)$row['project_id'],
        'title' => $row['title'],
        'revision' => (int)$row['revision'],
        'updatedAt' => $row['updated_at'],
        'data' => wf_document_decode((string)$row['data']),
    ];
}

/* ---------------------------------------------------------------- writes */

function wf_next_position(string $table, string $column, int $value): int
{
    // $table / $column are internal constants, never user input.
    $statement = wf_db()->prepare("SELECT COALESCE(MAX(position), -1) + 1 FROM {$table} WHERE {$column} = ?");
    $statement->execute([$value]);
    return (int)$statement->fetchColumn();
}

function wf_touch_project(int $projectId): void
{
    wf_db()->prepare('UPDATE wf_projects SET updated_at = ? WHERE id = ?')->execute([wf_now(), $projectId]);
}

/** Insert an already validated/encoded document at the end of the project. Returns the new id. */
function wf_insert_wireframe(int $userId, int $projectId, string $title, string $json): int
{
    $now = wf_now();
    wf_db()->prepare(
        'INSERT INTO wf_wireframes (project_id, user_id, title, data, revision, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
    )->execute([$projectId, $userId, $title, $json, wf_next_position('wf_wireframes', 'project_id', $projectId), $now, $now]);
    $id = (int)wf_db()->lastInsertId();
    wf_touch_project($projectId);
    return $id;
}

/**
 * New project at the end of the list, optionally with one blank wireframe
 * (default title "Screen 1"; the browser sends a localized one).
 *
 * @return array{projectId: int, wireframeId: int|null}
 */
function wf_project_create(int $userId, string $name, bool $withWireframe = true, string $wireframeTitle = ''): array
{
    $name = wf_require_name($name, WF_PROJECT_NAME_MAX, 'project');
    $now = wf_now();
    wf_db()->prepare('INSERT INTO wf_projects (user_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$userId, $name, wf_next_position('wf_projects', 'user_id', $userId), $now, $now]);
    $projectId = (int)wf_db()->lastInsertId();
    $wireframeId = null;
    if ($withWireframe) {
        $title = wf_clean_name($wireframeTitle, WF_WIREFRAME_TITLE_MAX) ?: 'Screen 1';
        $wireframeId = wf_insert_wireframe($userId, $projectId, $title, wf_document_json(wf_blank_document($title)));
    }
    return ['projectId' => $projectId, 'wireframeId' => $wireframeId];
}

function wf_project_rename(int $userId, int $projectId, string $name): array
{
    $project = wf_owned_project($userId, $projectId);
    $name = wf_require_name($name, WF_PROJECT_NAME_MAX, 'project');
    wf_db()->prepare('UPDATE wf_projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        ->execute([$name, wf_now(), $project['id'], $userId]);
    return ['id' => (int)$project['id'], 'name' => $name];
}

/** Deletes the project; foreign keys cascade to all of its wireframes. */
function wf_project_delete(int $userId, int $projectId): void
{
    $project = wf_owned_project($userId, $projectId);
    wf_db()->prepare('DELETE FROM wf_projects WHERE id = ? AND user_id = ?')->execute([$project['id'], $userId]);
}

/**
 * New wireframe at the end of the project: the given document (validated, stored as is except
 * for `title`, which is set to the wireframe title) or a blank one.
 */
function wf_wireframe_create(int $userId, int $projectId, string $title, $document = null): int
{
    $project = wf_owned_project($userId, $projectId);
    $title = wf_require_name($title, WF_WIREFRAME_TITLE_MAX, 'wireframe');
    $json = $document === null
        ? wf_document_json(wf_blank_document($title))
        : wf_document_json(wf_document_with_title($document, $title));
    return wf_insert_wireframe($userId, (int)$project['id'], $title, $json);
}

/**
 * Replace a wireframe's document with optimistic concurrency.
 *
 * The update only happens while the stored revision still equals `$baseRevision`; it then
 * becomes `$baseRevision + 1`. Otherwise another client saved in between and a 409 `conflict`
 * is thrown carrying the current server copy (`extra.current`) — nothing is overwritten.
 * `$force` skips the check; only the browser's explicit "Keep my version" uses it.
 *
 * Title: `$title` if given, else the document's own title, else the current one; the document
 * is stored with that title so the panel and the document never disagree.
 *
 * @return array{revision: int, title: string}
 */
function wf_wireframe_save(int $userId, int $wireframeId, $document, string $title, int $baseRevision, bool $force = false): array
{
    $wireframe = wf_owned_wireframe($userId, $wireframeId);
    $title = wf_clean_name($title, WF_WIREFRAME_TITLE_MAX);
    if ($title === '') $title = wf_clean_name(wf_document_field($document, 'title'), WF_WIREFRAME_TITLE_MAX);
    if ($title === '') $title = (string)$wireframe['title'];
    $json = wf_document_json(wf_document_with_title($document, $title));

    $sql = 'UPDATE wf_wireframes SET data = ?, title = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?';
    $params = [$json, $title, wf_now(), $wireframe['id'], $userId];
    if (!$force) {
        $sql .= ' AND revision = ?';
        $params[] = $baseRevision;
    }
    $statement = wf_db()->prepare($sql);
    $statement->execute($params);
    if ($statement->rowCount() === 0) {
        $current = wf_wireframe_payload(wf_owned_wireframe($userId, (int)$wireframe['id']));
        throw new ApiError(
            409,
            'conflict',
            'This wireframe was changed elsewhere since revision ' . $baseRevision . ' (it is now at revision ' . $current['revision'] . ').',
            ['current' => $current]
        );
    }
    wf_touch_project((int)$wireframe['project_id']);
    $revision = $force ? (int)wf_owned_wireframe($userId, (int)$wireframe['id'])['revision'] : $baseRevision + 1;
    return ['revision' => $revision, 'title' => $title];
}

/** Rename; the title inside the document follows. Bumps the revision. Returns the new revision. */
function wf_wireframe_rename(int $userId, int $wireframeId, string $title): int
{
    $wireframe = wf_owned_wireframe($userId, $wireframeId);
    $title = wf_require_name($title, WF_WIREFRAME_TITLE_MAX, 'wireframe');
    $document = wf_document_decode((string)$wireframe['data']);
    $data = $document === null ? (string)$wireframe['data'] : wf_document_json(wf_document_with_title($document, $title));
    wf_db()->prepare(
        'UPDATE wf_wireframes SET title = ?, data = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?'
    )->execute([$title, $data, wf_now(), $wireframe['id'], $userId]);
    return (int)wf_owned_wireframe($userId, (int)$wireframe['id'])['revision'];
}

/** Copy at the end of the same project, titled "<title> copy" unless a title is given. Returns the new id. */
function wf_wireframe_duplicate(int $userId, int $wireframeId, string $title = ''): int
{
    $wireframe = wf_owned_wireframe($userId, $wireframeId);
    $title = wf_clean_name($title, WF_WIREFRAME_TITLE_MAX)
        ?: wf_clean_name($wireframe['title'] . ' copy', WF_WIREFRAME_TITLE_MAX);
    $document = wf_document_decode((string)$wireframe['data']);
    if ($document === null) throw new ApiError(400, 'bad_document', 'The stored wireframe could not be read.');
    return wf_insert_wireframe($userId, (int)$wireframe['project_id'], $title, wf_document_json(wf_document_with_title($document, $title)));
}

function wf_wireframe_delete(int $userId, int $wireframeId): void
{
    $wireframe = wf_owned_wireframe($userId, $wireframeId);
    wf_db()->prepare('DELETE FROM wf_wireframes WHERE id = ? AND user_id = ?')->execute([$wireframe['id'], $userId]);
    wf_touch_project((int)$wireframe['project_id']);
}

/**
 * First sign-in gets one project with one blank wireframe, so the editor never opens empty. The
 * browser sends the names in the user's language (`starter.project`, `starter.wireframe`).
 */
function wf_ensure_starter_project(int $userId, string $projectName = '', string $wireframeTitle = ''): void
{
    $statement = wf_db()->prepare('SELECT COUNT(*) FROM wf_projects WHERE user_id = ?');
    $statement->execute([$userId]);
    if ((int)$statement->fetchColumn() > 0) return;
    wf_project_create(
        $userId,
        wf_clean_name($projectName, WF_PROJECT_NAME_MAX) ?: 'My first project',
        true,
        wf_clean_name($wireframeTitle, WF_WIREFRAME_TITLE_MAX) ?: 'Home screen'
    );
}
