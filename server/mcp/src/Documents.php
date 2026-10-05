<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Server\RequestContext;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Validator;

/**
 * Project documents arriving through MCP tool arguments.
 *
 * Two jobs:
 *
 * 1. Lossless extraction. The SDK decodes JSON-RPC with `json_decode(..., true)`, which cannot
 *    tell `{}` from `[]` and turns `{"0": …}` into a list — storing that would silently rewrite
 *    fields the server does not understand (future element data, Drawing strokes, …). So the
 *    `data` argument is re-read from the raw request body with objects kept as `stdClass`,
 *    matched by JSON-RPC id. The SDK's copy is only a fallback.
 *
 * 2. Validation against the GENERATED JSON Schema (`resources/project-schema.json`, written from
 *    `src/utils/schemaExport.ts` by `npm run mcp:resources`). There is no hand-written PHP model:
 *    if the TypeScript model changes, the schema file changes with it. Unknown extra fields are
 *    allowed by the schema, so additive data passes through untouched.
 */
final class Documents
{
    public function __construct(
        private readonly string $rawBody,
        private readonly string $schemaPath,
    ) {
    }

    /** The named tool argument exactly as the client sent it (objects as stdClass), or null. */
    public function rawArgument(RequestContext $context, string $name, mixed $fallback): mixed
    {
        $decoded = json_decode($this->rawBody, false);
        $messages = is_array($decoded) ? $decoded : [$decoded];
        $id = $context->getRequest()->getId();
        foreach ($messages as $message) {
            if (!$message instanceof \stdClass || !property_exists($message, 'id') || $message->id !== $id) continue;
            $arguments = $message->params->arguments ?? null;
            if ($arguments instanceof \stdClass && property_exists($arguments, $name)) return $arguments->{$name};
        }
        // Not found in the raw body (should not happen): re-encode the SDK's copy.
        return $fallback === null ? null : json_decode((string)json_encode($fallback), false);
    }

    /** Throws `bad_document` with the first schema violations, or `too_large`. */
    public function validate(mixed $document): void
    {
        if (!$document instanceof \stdClass) {
            throw new ApiError(400, 'bad_document', '`data` must be a JSON object: the complete Wirefragma project (see get_wirefragma_schema).');
        }
        $json = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json !== false && strlen($json) > WF_MAX_DOCUMENT_BYTES) {
            throw new ApiError(413, 'too_large', 'This wireframe is larger than 2 MB and cannot be saved.');
        }

        $validator = new Validator();
        $validator->setMaxErrors(5);
        $schema = json_decode((string)file_get_contents($this->schemaPath), false);
        $result = $validator->validate($document, $schema);
        if ($result->isValid()) return;

        $problems = [];
        foreach ((new ErrorFormatter())->format($result->error(), false) as $pointer => $message) {
            $problems[] = ($pointer === '/' || $pointer === '' ? '(document)' : $pointer) . ': ' . $message;
            if (count($problems) === 5) break;
        }
        throw new ApiError(
            400,
            'bad_document',
            'The project does not match the Wirefragma schema (read get_wirefragma_schema): ' . implode('; ', $problems),
            ['problems' => $problems]
        );
    }
}
