<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Schema\Content\TextContent;
use Mcp\Schema\Result\CallToolResult;

/**
 * Tool results in one shape.
 *
 * Success: the JSON payload as text content (what most clients show the model) plus the same
 * object as `structuredContent` — except when it carries a whole document, which would double a
 * payload of up to 2 MB; those are text only.
 *
 * Failure: `isError: true` with `{"error": "<code>", "message": "…", …}` — codes `unauthorized`,
 * `forbidden_scope`, `not_found`, `bad_request`, `bad_name`, `bad_document`, `too_large`,
 * `conflict` (+ `current`), `confirmation_mismatch`, `rate_limited`, `server_error`. Tool errors
 * (rather than JSON-RPC errors) are what MCP recommends for failures the model should see and
 * recover from. No SQL, paths, stack traces or configuration ever reach the client.
 */
final class ToolResult
{
    private const JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;

    public static function ok(array $payload, bool $structured = true): CallToolResult
    {
        return new CallToolResult([new TextContent((string)json_encode($payload, self::JSON))], false, $structured ? $payload : null);
    }

    public static function error(ApiError $error): CallToolResult
    {
        $code = match ($error->errorCode) {
            'db_unavailable', 'not_configured', 'server' => 'server_error',
            'bad_scopes', 'bad_expiry', 'bad_json' => 'bad_request',
            default => $error->errorCode,
        };
        $message = $code === 'server_error' ? 'The Wirefragma server is temporarily unavailable. Try again later.' : $error->getMessage();
        $payload = ['error' => $code, 'message' => $message] + $error->extra;
        if ($code === 'conflict') {
            $payload['hint'] = 'Re-apply your intended change to `current.data` and call update_wireframe again with baseRevision = current.revision. Do not resend the old document.';
        }
        // The conflict copy can be large: keep structuredContent to the metadata.
        $structured = $payload;
        if (isset($structured['current']['data'])) unset($structured['current']['data']);
        return new CallToolResult([new TextContent((string)json_encode($payload, self::JSON))], true, $structured);
    }

    /** Unexpected failure: logged server-side (message only), generic to the client. */
    public static function unexpected(\Throwable $error): CallToolResult
    {
        error_log('[wirefragma-mcp] ' . get_class($error) . ': ' . $error->getMessage() . ' @ ' . basename($error->getFile()) . ':' . $error->getLine());
        return self::error(new ApiError(500, 'server_error', 'Something went wrong on the server.'));
    }
}
