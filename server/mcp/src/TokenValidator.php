<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use Mcp\Server\Transport\Http\OAuth\AuthorizationResult;
use Mcp\Server\Transport\Http\OAuth\AuthorizationTokenValidatorInterface;

/**
 * Personal MCP token → Wirefragma user, implemented against the SDK's validator interface.
 *
 * Because it speaks `AuthorizationTokenValidatorInterface`, adding OAuth later means plugging an
 * OAuth-aware validator (e.g. the SDK's JwtTokenValidator, or one that accepts both kinds) into
 * the SDK's AuthorizationMiddleware — the tools, which only read `Identity`, do not change.
 *
 * The raw token is hashed by `wf_mcp_token_resolve` and never logged.
 */
final class TokenValidator implements AuthorizationTokenValidatorInterface
{
    /** Requests per token per hour (all MCP traffic: handshakes, lists, reads, writes). */
    public const REQUESTS_PER_HOUR = 3000;
    /** Failed authentications per client IP per 10 minutes. Valid tokens are never IP-limited. */
    public const FAILURES_PER_IP = 300;

    public function __construct(private readonly Identity $identity)
    {
    }

    public function validate(string $accessToken): AuthorizationResult
    {
        $grant = wf_mcp_token_resolve($accessToken);
        if ($grant === null) {
            wf_rate_limit('mcp-auth-failure', wf_client_ip(), self::FAILURES_PER_IP, 600);
            return AuthorizationResult::unauthorized('invalid_token', 'The MCP token is invalid, expired or revoked.');
        }
        wf_rate_limit('mcp-requests', 'token:' . $grant['tokenId'], self::REQUESTS_PER_HOUR, 3600);

        $this->identity->grant($grant['userId'], $grant['tokenId'], $grant['scopes']);
        return AuthorizationResult::allow([
            'wirefragma.user_id' => $grant['userId'],
            'wirefragma.token_id' => $grant['tokenId'],
            'wirefragma.scopes' => $grant['scopes'],
        ]);
    }
}
