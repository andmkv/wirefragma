<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Schema\Result\CallToolResult;
use Mcp\Schema\ToolAnnotations;
use Mcp\Server\Builder;
use Mcp\Server\RequestContext;

/**
 * The MCP tool surface: deliberately small and document-level.
 *
 * The canonical `WireframeProject` JSON already is the API — there is no `add_button` /
 * `move_element` family. An agent reads a whole document, changes it, and writes it back with
 * optimistic concurrency, exactly like the browser editor does.
 *
 * Every tool is a thin adapter over lib/projects.php (the same functions the browser API uses):
 * scope check → argument mapping → shared function → result. No project logic lives here.
 */
final class Tools
{
    /** MCP writes per user per hour (the browser's autosave allows 1200). */
    public const WRITES_PER_HOUR = 600;

    private const ID = ['type' => 'integer', 'minimum' => 1];

    public function __construct(
        private readonly Identity $identity,
        private readonly Documents $documents,
        private readonly string $schemaMarkdownPath,
    ) {
    }

    public function register(Builder $builder): void
    {
        $readOnly = new ToolAnnotations(readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false);
        $additive = new ToolAnnotations(readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false);
        $replacing = new ToolAnnotations(readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false);
        $destructive = new ToolAnnotations(readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false);

        $builder->addTool(
            fn (): CallToolResult => $this->run(fn () => $this->listProjects()),
            name: 'list_projects',
            title: 'List projects',
            description: <<<'TXT'
                List the user's Wirefragma projects and the wireframes (screens) in each — metadata only: ids, names/titles, `revision`, `updatedAt`. No documents; call get_wireframe for one. Needs the `read` permission.
                TXT,
            annotations: $readOnly,
            inputSchema: ['type' => 'object', 'properties' => new \stdClass(), 'additionalProperties' => false],
        );

        $builder->addTool(
            fn (): CallToolResult => $this->run(fn () => ToolResult::ok([
                'schema' => (string)file_get_contents($this->schemaMarkdownPath),
            ], false)),
            name: 'get_wirefragma_schema',
            title: 'Wirefragma project format',
            description: <<<'TXT'
                Return the Wirefragma project format: document shape, coordinate system, every element type and how to fill it, layers and nesting, a complete example, the JSON Schema that create_wireframe / update_wireframe validate against, and the editing rules. Read it once before creating or changing a wireframe. Same content as the `wirefragma://schema` resource. Needs `read`.
                TXT,
            annotations: $readOnly,
            inputSchema: ['type' => 'object', 'properties' => new \stdClass(), 'additionalProperties' => false],
        );

        $builder->addTool(
            fn (int $wireframeId): CallToolResult => $this->run(fn () => $this->getWireframe($wireframeId)),
            name: 'get_wireframe',
            title: 'Read a wireframe',
            description: <<<'TXT'
                Read one wireframe: `{id, projectId, title, revision, updatedAt, data}`. `data` is the canonical Wirefragma project document exactly as stored — the same JSON the editor, the `ui-project` export block and JSON export use. Keep `revision`: update_wireframe needs it as `baseRevision`. Needs `read`.
                TXT,
            annotations: $readOnly,
            inputSchema: [
                'type' => 'object',
                'properties' => ['wireframeId' => self::ID + ['description' => 'Wireframe id from list_projects.']],
                'required' => ['wireframeId'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (string $name, bool $withWireframe = true, string $wireframeTitle = ''): CallToolResult => $this->run(
                fn () => $this->createProject($name, $withWireframe, $wireframeTitle)
            ),
            name: 'create_project',
            title: 'Create a project',
            description: <<<'TXT'
                Create a new project (a folder of wireframes) at the end of the user's list. By default it also gets one blank wireframe titled `wireframeTitle` (default "Screen 1"), exactly like the editor's "New project". Returns `projectId` and `wireframeId` (null when `withWireframe` is false). Needs `write`.
                TXT,
            annotations: $additive,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WF_PROJECT_NAME_MAX, 'description' => 'Project name.'],
                    'withWireframe' => ['type' => 'boolean', 'default' => true, 'description' => 'Also create one blank wireframe (default true).'],
                    'wireframeTitle' => ['type' => 'string', 'maxLength' => WF_WIREFRAME_TITLE_MAX, 'description' => 'Title of that wireframe (default "Screen 1").'],
                ],
                'required' => ['name'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (int $projectId, string $name): CallToolResult => $this->run(fn () => $this->renameProject($projectId, $name)),
            name: 'rename_project',
            title: 'Rename a project',
            description: 'Rename a project. Names are trimmed and capped at 120 characters. Needs `write`.',
            annotations: new ToolAnnotations(readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false),
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'projectId' => self::ID,
                    'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WF_PROJECT_NAME_MAX],
                ],
                'required' => ['projectId', 'name'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (RequestContext $context, int $projectId, string $title, mixed $data = null): CallToolResult => $this->run(
                fn () => $this->createWireframe($context, $projectId, $title, $data)
            ),
            name: 'create_wireframe',
            title: 'Create a wireframe',
            description: <<<'TXT'
                Create a wireframe (screen) at the end of a project. Without `data` it is the same blank document the editor creates. With `data` it stores your complete Wirefragma project document, validated against the schema from get_wirefragma_schema (read that first); its `title` is set to `title`. Returns `wireframeId`, `projectId`, `title` and `revision` (1). Needs `write`.
                TXT,
            annotations: $additive,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'projectId' => self::ID + ['description' => 'Target project id from list_projects.'],
                    'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WF_WIREFRAME_TITLE_MAX, 'description' => 'Wireframe title; also written into data.title.'],
                    'data' => ['type' => 'object', 'description' => 'Optional complete Wirefragma project document (see get_wirefragma_schema). Omit for a blank wireframe.'],
                ],
                'required' => ['projectId', 'title'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (RequestContext $context, int $wireframeId, int $baseRevision, mixed $data = null, string $title = ''): CallToolResult => $this->run(
                fn () => $this->updateWireframe($context, $wireframeId, $baseRevision, $data, $title)
            ),
            name: 'update_wireframe',
            title: 'Replace a wireframe document',
            description: <<<'TXT'
                Replace a wireframe's document with a new complete version (whole-document write with optimistic concurrency — there is no force/overwrite option).

                Safe editing procedure:
                1. get_wireframe → keep `data` and `revision`.
                2. Change only what the user asked for. Keep every other element, layer, id and field unchanged — including fields you do not recognise (other clients and newer versions store data there).
                3. Call update_wireframe with the WHOLE modified document as `data` and `baseRevision` = the revision you read.
                4. If the result is a `conflict` error, the wireframe changed since you read it (the user in the browser, another device or agent). The error contains `current` (the latest document and its revision): re-apply your change to `current.data` and retry with `baseRevision` = `current.revision`. Never resend the old document.

                `data` must follow get_wirefragma_schema and is validated before saving. `title` (optional) renames the wireframe; otherwise `data.title` is used. On success returns the new `revision`. Needs `write`.
                TXT,
            annotations: $replacing,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'wireframeId' => self::ID,
                    'baseRevision' => self::ID + ['description' => 'The `revision` returned by get_wireframe (or by the conflict error) that `data` is based on.'],
                    'data' => ['type' => 'object', 'description' => 'The complete modified Wirefragma project document.'],
                    'title' => ['type' => 'string', 'maxLength' => WF_WIREFRAME_TITLE_MAX, 'description' => 'Optional new title.'],
                ],
                'required' => ['wireframeId', 'baseRevision', 'data'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (int $wireframeId, string $title): CallToolResult => $this->run(fn () => $this->renameWireframe($wireframeId, $title)),
            name: 'rename_wireframe',
            title: 'Rename a wireframe',
            description: 'Rename a wireframe. The title stored inside its document is updated too, and the revision increases (returned as `revision`). Needs `write`.',
            annotations: new ToolAnnotations(readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false),
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'wireframeId' => self::ID,
                    'title' => ['type' => 'string', 'minLength' => 1, 'maxLength' => WF_WIREFRAME_TITLE_MAX],
                ],
                'required' => ['wireframeId', 'title'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (int $wireframeId, string $title = ''): CallToolResult => $this->run(fn () => $this->duplicateWireframe($wireframeId, $title)),
            name: 'duplicate_wireframe',
            title: 'Duplicate a wireframe',
            description: 'Copy a wireframe into the same project (appended at the end). The copy is titled "<title> copy" unless `title` is given. Returns the new `wireframeId`. Needs `write`.',
            annotations: $additive,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'wireframeId' => self::ID,
                    'title' => ['type' => 'string', 'maxLength' => WF_WIREFRAME_TITLE_MAX, 'description' => 'Optional title for the copy.'],
                ],
                'required' => ['wireframeId'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (int $wireframeId, string $confirmTitle): CallToolResult => $this->run(fn () => $this->deleteWireframe($wireframeId, $confirmTitle)),
            name: 'delete_wireframe',
            title: 'Delete a wireframe',
            description: <<<'TXT'
                Permanently delete ONE wireframe. There is no undo and no trash. Only do this when the user explicitly asked for this deletion. `confirmTitle` must equal the wireframe's current title exactly (read it with list_projects), otherwise nothing is deleted. Needs the `delete` permission, which tokens do not have by default.
                TXT,
            annotations: $destructive,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'wireframeId' => self::ID,
                    'confirmTitle' => ['type' => 'string', 'description' => 'The current title of the wireframe, as a safety confirmation.'],
                ],
                'required' => ['wireframeId', 'confirmTitle'],
                'additionalProperties' => false,
            ],
        );

        $builder->addTool(
            fn (int $projectId, string $confirmName): CallToolResult => $this->run(fn () => $this->deleteProject($projectId, $confirmName)),
            name: 'delete_project',
            title: 'Delete a project',
            description: <<<'TXT'
                Permanently delete a project AND ALL OF ITS WIREFRAMES (the deletion cascades). There is no undo and no trash. Only do this when the user explicitly asked for it. `confirmName` must equal the project's current name exactly, otherwise nothing is deleted. Needs the `delete` permission, which tokens do not have by default.
                TXT,
            annotations: $destructive,
            inputSchema: [
                'type' => 'object',
                'properties' => [
                    'projectId' => self::ID,
                    'confirmName' => ['type' => 'string', 'description' => 'The current name of the project, as a safety confirmation.'],
                ],
                'required' => ['projectId', 'confirmName'],
                'additionalProperties' => false,
            ],
        );
    }

    /* ------------------------------------------------------------- handlers */

    /** @param callable(): CallToolResult $body */
    private function run(callable $body): CallToolResult
    {
        try {
            return $body();
        } catch (ApiError $error) {
            return ToolResult::error($error);
        } catch (\Throwable $error) {
            return ToolResult::unexpected($error);
        }
    }

    /** Scope check + the write-rate limit shared by every mutating tool. */
    private function writer(string $scope = 'write'): int
    {
        $userId = $this->identity->requireScope($scope);
        wf_rate_limit('mcp-writes', (string)$userId, self::WRITES_PER_HOUR, 3600);
        return $userId;
    }

    private function listProjects(): CallToolResult
    {
        return ToolResult::ok(['projects' => wf_projects_tree($this->identity->requireScope('read'))]);
    }

    private function getWireframe(int $wireframeId): CallToolResult
    {
        $userId = $this->identity->requireScope('read');
        return ToolResult::ok(wf_wireframe_payload(wf_owned_wireframe($userId, $wireframeId)), false);
    }

    private function createProject(string $name, bool $withWireframe, string $wireframeTitle): CallToolResult
    {
        $userId = $this->writer();
        $created = wf_project_create($userId, $name, $withWireframe, $wireframeTitle);
        $project = wf_owned_project($userId, $created['projectId']);
        return ToolResult::ok([
            'ok' => true,
            'projectId' => $created['projectId'],
            'name' => $project['name'],
            'wireframeId' => $created['wireframeId'],
            'wireframe' => $created['wireframeId'] === null ? null : $this->summary($userId, $created['wireframeId']),
        ]);
    }

    private function renameProject(int $projectId, string $name): CallToolResult
    {
        $userId = $this->writer();
        $renamed = wf_project_rename($userId, $projectId, $name);
        return ToolResult::ok(['ok' => true, 'projectId' => $renamed['id'], 'name' => $renamed['name']]);
    }

    private function createWireframe(RequestContext $context, int $projectId, string $title, mixed $data): CallToolResult
    {
        $userId = $this->writer();
        $document = null;
        if ($data !== null) {
            $document = $this->documents->rawArgument($context, 'data', $data);
            $this->documents->validate(wf_document_with_title($document, wf_clean_name($title, WF_WIREFRAME_TITLE_MAX)));
        }
        $id = wf_wireframe_create($userId, $projectId, $title, $document);
        return ToolResult::ok(['ok' => true, 'wireframeId' => $id] + $this->summary($userId, $id));
    }

    private function updateWireframe(RequestContext $context, int $wireframeId, int $baseRevision, mixed $data, string $title): CallToolResult
    {
        $userId = $this->writer();
        $document = $this->documents->rawArgument($context, 'data', $data);
        $this->documents->validate($document);
        // force = false, always: MCP never overwrites a newer revision.
        $saved = wf_wireframe_save($userId, $wireframeId, $document, $title, $baseRevision, false);
        return ToolResult::ok(['ok' => true, 'wireframeId' => $wireframeId, 'revision' => $saved['revision'], 'title' => $saved['title']]);
    }

    private function renameWireframe(int $wireframeId, string $title): CallToolResult
    {
        $userId = $this->writer();
        $revision = wf_wireframe_rename($userId, $wireframeId, $title);
        return ToolResult::ok(['ok' => true, 'wireframeId' => $wireframeId, 'revision' => $revision] + $this->summary($userId, $wireframeId));
    }

    private function duplicateWireframe(int $wireframeId, string $title): CallToolResult
    {
        $userId = $this->writer();
        $id = wf_wireframe_duplicate($userId, $wireframeId, $title);
        return ToolResult::ok(['ok' => true, 'wireframeId' => $id, 'sourceWireframeId' => $wireframeId] + $this->summary($userId, $id));
    }

    private function deleteWireframe(int $wireframeId, string $confirmTitle): CallToolResult
    {
        $userId = $this->writer('delete');
        $wireframe = wf_owned_wireframe($userId, $wireframeId);
        if (trim($confirmTitle) !== (string)$wireframe['title']) {
            throw new ApiError(400, 'confirmation_mismatch', 'Nothing was deleted: confirmTitle does not match the wireframe\'s current title "' . $wireframe['title'] . '".');
        }
        wf_wireframe_delete($userId, $wireframeId);
        return ToolResult::ok(['ok' => true, 'deletedWireframeId' => $wireframeId, 'title' => $wireframe['title']]);
    }

    private function deleteProject(int $projectId, string $confirmName): CallToolResult
    {
        $userId = $this->writer('delete');
        $project = wf_owned_project($userId, $projectId);
        if (trim($confirmName) !== (string)$project['name']) {
            throw new ApiError(400, 'confirmation_mismatch', 'Nothing was deleted: confirmName does not match the project\'s current name "' . $project['name'] . '".');
        }
        $count = 0;
        foreach (wf_projects_tree($userId) as $candidate) {
            if ($candidate['id'] === (int)$project['id']) $count = count($candidate['wireframes']);
        }
        wf_project_delete($userId, $projectId);
        return ToolResult::ok(['ok' => true, 'deletedProjectId' => $projectId, 'name' => $project['name'], 'deletedWireframes' => $count]);
    }

    /** Metadata of one wireframe (no document). */
    private function summary(int $userId, int $wireframeId): array
    {
        $row = wf_owned_wireframe($userId, $wireframeId);
        return [
            'projectId' => (int)$row['project_id'],
            'title' => $row['title'],
            'revision' => (int)$row['revision'],
            'updatedAt' => $row['updated_at'],
        ];
    }
}
