<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Exception\ResourceReadException;
use Mcp\Schema\Content\TextResourceContents;
use Mcp\Server\Builder;

/**
 * MCP resources — read-only views of the same data the tools return (tools remain the primary
 * interface; many clients never read resources on their own):
 *
 *   wirefragma://schema              the project format for writing documents (Markdown)
 *   wirefragma://schema/project.json the JSON Schema documents are validated against
 *   wirefragma://projects            the project tree (same as list_projects)
 *   wirefragma://wireframes/{id}     one wireframe with its canonical document (same as get_wireframe)
 *
 * The two schema files are generated from the TypeScript model (`npm run mcp:resources`).
 * No subscriptions: the browser notices changes by polling, and agents re-read on demand.
 */
final class Resources
{
    private const JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;

    public function __construct(
        private readonly Identity $identity,
        private readonly string $resourcesDir,
    ) {
    }

    public function register(Builder $builder): void
    {
        $builder->addResource(
            fn (): TextResourceContents => $this->read('wirefragma://schema', 'text/markdown', fn () => $this->file('wirefragma-schema.md')),
            uri: 'wirefragma://schema',
            name: 'wirefragma-schema',
            title: 'Wirefragma project format',
            description: 'How to write a Wirefragma project document: shape, element types, layers, nesting, a complete example, the JSON Schema and the editing rules.',
            mimeType: 'text/markdown',
        );

        $builder->addResource(
            fn (): TextResourceContents => $this->read('wirefragma://schema/project.json', 'application/schema+json', fn () => $this->file('project-schema.json')),
            uri: 'wirefragma://schema/project.json',
            name: 'wirefragma-project-json-schema',
            title: 'Wirefragma project JSON Schema',
            description: 'JSON Schema (draft 2020-12) that create_wireframe / update_wireframe validate `data` against.',
            mimeType: 'application/schema+json',
        );

        $builder->addResource(
            fn (): TextResourceContents => $this->read(
                'wirefragma://projects',
                'application/json',
                fn () => (string)json_encode(['projects' => wf_projects_tree($this->identity->requireScope('read'))], self::JSON)
            ),
            uri: 'wirefragma://projects',
            name: 'projects',
            title: 'Projects',
            description: 'The account\'s projects with wireframe ids, titles and revisions (no documents).',
            mimeType: 'application/json',
        );

        $builder->addResourceTemplate(
            fn (string $id): TextResourceContents => $this->read(
                'wirefragma://wireframes/' . $id,
                'application/json',
                fn () => (string)json_encode(
                    wf_wireframe_payload(wf_owned_wireframe($this->identity->requireScope('read'), ctype_digit($id) ? (int)$id : 0)),
                    self::JSON
                )
            ),
            uriTemplate: 'wirefragma://wireframes/{id}',
            name: 'wireframe',
            title: 'Wireframe',
            description: 'One wireframe: id, projectId, title, revision, updatedAt and `data`, the canonical project document.',
            mimeType: 'application/json',
        );
    }

    /** @param callable(): string $body */
    private function read(string $uri, string $mimeType, callable $body): TextResourceContents
    {
        try {
            return new TextResourceContents($uri, $mimeType, $body());
        } catch (ApiError $error) {
            $message = in_array($error->errorCode, ['db_unavailable', 'not_configured'], true)
                ? 'The Wirefragma server is temporarily unavailable.'
                : $error->getMessage();
            throw new ResourceReadException($error->errorCode . ': ' . $message);
        } catch (ResourceReadException $error) {
            throw $error;
        } catch (\Throwable $error) {
            error_log('[wirefragma-mcp] ' . get_class($error) . ': ' . $error->getMessage());
            throw new ResourceReadException('server_error: Something went wrong on the server.');
        }
    }

    private function file(string $name): string
    {
        $this->identity->requireScope('read');
        $content = @file_get_contents($this->resourcesDir . '/' . $name);
        if ($content === false) throw new ApiError(500, 'server_error', 'Resource file missing.');
        return $content;
    }
}
