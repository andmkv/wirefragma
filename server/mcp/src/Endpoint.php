<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Server;
use Mcp\Server\Session\FileSessionStore;
use Mcp\Server\Transport\Http\Middleware\CorsMiddleware;
use Mcp\Server\Transport\Http\Middleware\DnsRebindingProtectionMiddleware;
use Mcp\Server\Transport\StreamableHttpTransport;
use Nyholm\Psr7\Factory\Psr17Factory;
use Nyholm\Psr7Server\ServerRequestCreator;
use Psr\Http\Message\ResponseInterface;

/**
 * The remote MCP endpoint: one PHP request in, one response out (Streamable HTTP).
 *
 * Runs as ordinary PHP on shared hosting — no daemon, no worker, nothing long-lived:
 *
 *   PSR-7 request ─► CORS ─► DNS-rebinding (Host/Origin allowlist) ─► Bearer token
 *                ─► SDK transport (handshake era with file-backed MCP sessions, or the
 *                   stateless 2026-07-28 era) ─► tools / resources ─► lib/projects.php ─► MySQL
 *
 * MCP protocol sessions (the `Mcp-Session-Id` of handshake-era clients) are files in a private
 * directory. They hold protocol state only — never the user identity, which is re-derived from
 * the bearer token on every request — and are unrelated to the browser's PHP login session.
 */
final class Endpoint
{
    public const SERVER_VERSION = '1.0.0';

    /** Covers a 2 MB document even when a client escapes every non-ASCII character (\uXXXX). */
    public const MAX_BODY_BYTES = 2 * WF_MAX_DOCUMENT_BYTES + 262144;

    /** Handshake-era MCP sessions expire after a day without use. */
    public const SESSION_TTL = 86400;

    public const INSTRUCTIONS = <<<'TXT'
        Wirefragma is a wireframe editor. This server gives you the signed-in user's Wirefragma projects: projects are folders, each wireframe (screen) is one JSON document — the canonical Wirefragma project, the same one the visual editor edits. The user may have the same wireframe open in the browser while you work; the editor picks up your saves within seconds.

        Start with list_projects. Before writing a document, read get_wirefragma_schema once.

        When editing an existing wireframe:
        1. get_wireframe and keep its revision;
        2. preserve every element, layer, id and field unrelated to the request — including fields you do not recognise;
        3. change the minimum necessary part;
        4. update_wireframe with the whole document and baseRevision = that revision;
        5. on a conflict error, re-apply your change to the `current` document it returns and retry with its revision — never force, never resend the stale document.

        Deleting needs the separate `delete` permission and an exact name confirmation; only delete when the user explicitly asks.
        TXT;

    public static function handle(): void
    {
        $factory = new Psr17Factory();
        try {
            $config = wf_config()['mcp'] ?? [];
            if (($config['enabled'] ?? true) === false) {
                self::emit(self::plain($factory, 404, ['error' => 'not_found', 'message' => 'MCP is disabled on this server.']));
                return;
            }

            $request = (new ServerRequestCreator($factory, $factory, $factory, $factory))->fromGlobals();
            // Some Apache/FastCGI setups hide the header from getallheaders(); .htaccess forwards it.
            if (!$request->hasHeader('Authorization')) {
                $forwarded = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
                if ($forwarded !== '') $request = $request->withHeader('Authorization', $forwarded);
            }

            // Read the body once, bounded; the transport and the tools both use this copy.
            $raw = '';
            if ($request->getMethod() === 'POST') {
                $raw = (string)stream_get_contents(fopen('php://input', 'rb'), self::MAX_BODY_BYTES + 1);
                if (strlen($raw) > self::MAX_BODY_BYTES) {
                    self::emit(self::plain($factory, 413, [
                        'jsonrpc' => '2.0',
                        'id' => null,
                        'error' => ['code' => -32600, 'message' => 'Request body exceeds the maximum allowed size.'],
                    ]));
                    return;
                }
            }
            $request = $request->withBody($factory->createStream($raw));

            $resources = __DIR__ . '/../resources';
            $identity = new Identity();
            $logger = new ErrorLogLogger();

            $builder = Server::builder()
                ->setServerInfo('Wirefragma', self::SERVER_VERSION, 'Wireframes of your Wirefragma account', websiteUrl: wf_app_url(), title: 'Wirefragma')
                ->setInstructions(self::INSTRUCTIONS)
                ->setLogger($logger)
                ->setSession(new FileSessionStore(self::sessionDirectory($config), self::SESSION_TTL));
            (new Tools($identity, new Documents($raw, $resources . '/project-schema.json'), $resources . '/wirefragma-schema.md'))->register($builder);
            (new Resources($identity, $resources))->register($builder);

            $transport = new StreamableHttpTransport(
                $request,
                $factory,
                $factory,
                $logger,
                [
                    // No Access-Control-Allow-Origin unless origins are configured explicitly:
                    // MCP clients are native/server-side; browsers get nothing by default.
                    new CorsMiddleware(self::stringList($config['allowed_origins'] ?? [])),
                    new DnsRebindingProtectionMiddleware(self::allowedHosts($config), $factory, $factory),
                    new BearerAuthMiddleware(new TokenValidator($identity), $factory, $factory),
                ],
                self::MAX_BODY_BYTES,
            );
            self::emit($builder->build()->run($transport));
        } catch (ApiError $error) {
            // not_configured / db_unavailable before the protocol started.
            self::emit(self::plain($factory, $error->status === 503 ? 503 : 500, [
                'error' => 'server_error',
                'message' => $error->status === 503 ? 'The Wirefragma server is not available.' : 'Server error.',
            ]));
        } catch (\Throwable $error) {
            error_log('[wirefragma-mcp] ' . get_class($error) . ': ' . $error->getMessage() . ' @ ' . basename($error->getFile()) . ':' . $error->getLine());
            self::emit(self::plain($factory, 500, ['error' => 'server_error', 'message' => 'Server error.']));
        }
    }

    /**
     * Private, writable, NOT web-served. Configure `mcp.session_dir` in production (e.g.
     * /home/USER/.wirefragma-mcp-sessions, next to wirefragma-config.php); the default is the
     * system temp directory, which is also outside the web root.
     */
    private static function sessionDirectory(array $config): string
    {
        $dir = $config['session_dir'] ?? '';
        return is_string($dir) && $dir !== '' ? $dir : sys_get_temp_dir() . '/wirefragma-mcp-sessions';
    }

    /** Host allowlist against DNS rebinding: the app's own host(s) plus loopback for local work. */
    private static function allowedHosts(array $config): array
    {
        $hosts = self::stringList($config['allowed_hosts'] ?? []);
        foreach ([wf_app_url(), (string)($config['endpoint'] ?? '')] as $url) {
            $host = parse_url($url, PHP_URL_HOST);
            if (is_string($host) && $host !== '') $hosts[] = $host;
        }
        return array_values(array_unique(array_map('strtolower', array_merge($hosts, ['localhost', '127.0.0.1', '[::1]']))));
    }

    private static function stringList(mixed $value): array
    {
        return is_array($value) ? array_values(array_filter($value, 'is_string')) : [];
    }

    private static function plain(Psr17Factory $factory, int $status, array $payload): ResponseInterface
    {
        return $factory->createResponse($status)
            ->withHeader('Content-Type', 'application/json')
            ->withBody($factory->createStream((string)json_encode($payload, JSON_UNESCAPED_SLASHES)));
    }

    private static function emit(ResponseInterface $response): void
    {
        http_response_code($response->getStatusCode());
        foreach ($response->getHeaders() as $name => $values) {
            foreach ($values as $value) header($name . ': ' . $value, false);
        }
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        $body = $response->getBody();
        if ($body->isSeekable()) $body->rewind();
        while (!$body->eof()) {
            echo $body->read(65536);
        }
    }
}
