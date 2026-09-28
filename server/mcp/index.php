<?php
/**
 * Wirefragma remote MCP endpoint — https://<your host>/mcp/  (Streamable HTTP).
 *
 * The only file in this folder that is meant to be reachable over HTTP (.htaccess denies the
 * rest). It reuses the accounts backend's configuration and persistence layer from ../api/lib,
 * so MCP and the browser operate on the same users, projects, wireframes and revisions.
 *
 * Requires PHP 8.1+ and `composer install` in this folder (npm run mcp:install); the browser
 * API next door stays dependency-free and does not need either. See docs/mcp.md.
 */

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

function wf_mcp_unavailable(string $message): void
{
    http_response_code(503);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'server_error', 'message' => $message]);
}

if (PHP_VERSION_ID < 80100) {
    wf_mcp_unavailable('The MCP endpoint needs PHP 8.1 or newer.');
    return;
}
if (!is_file(__DIR__ . '/vendor/autoload.php')) {
    wf_mcp_unavailable('The MCP endpoint is not installed (run composer install in mcp/).');
    return;
}

require __DIR__ . '/vendor/autoload.php';
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/projects.php';
require dirname(__DIR__) . '/api/lib/mcp_tokens.php';

Wirefragma\Mcp\Endpoint::handle();
