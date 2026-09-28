<?php

declare(strict_types=1);

namespace Wirefragma\Mcp;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

/**
 * PSR-3 logger for the SDK: errors only, message text only, to PHP's error log.
 *
 * The context array is dropped on purpose — the SDK attaches tool arguments (whole documents)
 * and request data to some log calls, and none of that belongs in a shared-hosting log.
 * Authorization headers and tokens are never passed to a logger by this code.
 */
final class ErrorLogLogger extends AbstractLogger
{
    private const LEVELS = [LogLevel::EMERGENCY, LogLevel::ALERT, LogLevel::CRITICAL, LogLevel::ERROR];

    public function log($level, string|\Stringable $message, array $context = []): void
    {
        if (!in_array($level, self::LEVELS, true)) return;
        $exception = $context['exception'] ?? null;
        $detail = $exception instanceof \Throwable ? ' (' . get_class($exception) . ': ' . $exception->getMessage() . ')' : '';
        error_log('[wirefragma-mcp] ' . $message . $detail);
    }
}
