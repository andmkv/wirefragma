<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use ApiError;

/**
 * Who is calling, for the lifetime of ONE HTTP request.
 *
 * Filled by the bearer middleware after the token is validated and read by every tool and
 * resource. It is deliberately never stored in the MCP protocol session: each request is
 * re-authenticated from its own Authorization header, so a session id presented with another
 * user's token still acts as that other user — never as the session's creator.
 */
final class Identity
{
    private ?int $userId = null;
    private ?int $tokenId = null;
    /** @var list<string> */
    private array $scopes = [];

    /** @param list<string> $scopes */
    public function grant(int $userId, int $tokenId, array $scopes): void
    {
        $this->userId = $userId;
        $this->tokenId = $tokenId;
        $this->scopes = $scopes;
    }

    public function tokenId(): int
    {
        if ($this->tokenId === null) throw new ApiError(401, 'unauthorized', 'This request is not authenticated.');
        return $this->tokenId;
    }

    /**
     * The user id, provided the token carries `$scope`. Scope checks happen here, in one place,
     * before any tool touches account data.
     */
    public function requireScope(string $scope): int
    {
        if ($this->userId === null) throw new ApiError(401, 'unauthorized', 'This request is not authenticated.');
        if (!in_array($scope, $this->scopes, true)) {
            throw new ApiError(
                403,
                'forbidden_scope',
                "This MCP token does not have the \"{$scope}\" permission. Create a token with it in Wirefragma → Settings → MCP access."
            );
        }
        return $this->userId;
    }

    /** @return list<string> */
    public function scopes(): array
    {
        return $this->scopes;
    }
}
