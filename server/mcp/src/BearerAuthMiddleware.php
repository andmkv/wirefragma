<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;
use Mcp\Server\Transport\Http\OAuth\AuthorizationTokenValidatorInterface;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * `Authorization: Bearer …` on every MCP request (PSR-15).
 *
 * Why not the SDK's AuthorizationMiddleware: that one is an OAuth 2.1 *resource server* — its
 * 401 challenge must point clients at RFC 9728 protected-resource metadata naming at least one
 * authorization server, which personal tokens do not have. Advertising OAuth metadata without an
 * authorization server would send clients into a sign-in flow that cannot succeed. This class
 * keeps the same contract (an `AuthorizationTokenValidatorInterface`, 401/403 with a Bearer
 * challenge) without the OAuth discovery hint; switching to OAuth later = using the SDK
 * middleware with an OAuth-capable validator.
 *
 * Never logs the header or the token.
 */
final class BearerAuthMiddleware implements MiddlewareInterface
{
    public function __construct(
        private readonly AuthorizationTokenValidatorInterface $validator,
        private readonly ResponseFactoryInterface $responseFactory,
        private readonly StreamFactoryInterface $streamFactory,
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // CORS preflights carry no credentials; the transport answers them without touching data.
        if ($request->getMethod() === 'OPTIONS') return $handler->handle($request);

        $header = $request->getHeaderLine('Authorization');
        if (!preg_match('/^Bearer\s+(\S+)\s*$/i', $header, $matches)) {
            return $this->deny(401, 'invalid_request', 'unauthorized', 'Send your Wirefragma MCP token as "Authorization: Bearer wf_mcp_…". Create one in Wirefragma → Settings → MCP access.');
        }

        try {
            $result = $this->validator->validate($matches[1]);
        } catch (ApiError $error) {
            // 429 (rate limit) or 503 (database unavailable).
            $code = $error->status === 429 ? 'rate_limited' : 'server_error';
            $message = $error->status === 429 ? $error->getMessage() : 'The Wirefragma server is temporarily unavailable.';
            $response = $this->json($error->status === 429 ? 429 : 503, ['error' => $code, 'message' => $message]);
            return $error->status === 429 ? $response->withHeader('Retry-After', '60') : $response;
        }

        if (!$result->isAllowed()) {
            $status = $result->getStatusCode();
            return $this->deny(
                $status,
                $result->getError() ?? 'invalid_token',
                $status === 403 ? 'forbidden_scope' : 'unauthorized',
                $result->getErrorDescription() ?? 'The MCP token was not accepted.'
            );
        }

        foreach ($result->getAttributes() as $name => $value) {
            $request = $request->withAttribute($name, $value);
        }
        return $handler->handle($request);
    }

    private function deny(int $status, string $oauthError, string $code, string $message): ResponseInterface
    {
        $challenge = sprintf('Bearer realm="Wirefragma MCP", error="%s", error_description="%s"', $oauthError, addcslashes($message, '"\\'));
        return $this->json($status, ['error' => $code, 'message' => $message])->withHeader('WWW-Authenticate', $challenge);
    }

    private function json(int $status, array $payload): ResponseInterface
    {
        return $this->responseFactory->createResponse($status)
            ->withHeader('Content-Type', 'application/json')
            ->withBody($this->streamFactory->createStream((string)json_encode($payload, JSON_UNESCAPED_SLASHES)));
    }
}
