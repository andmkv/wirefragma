<?php
/**
 * Outgoing email: PHP mail(), a small authenticated SMTP client, or a log file for development.
 */

declare(strict_types=1);

function wf_send_mail(string $to, string $subject, string $text): bool
{
    $mail = wf_config()['mail'] ?? [];
    $transport = (string)($mail['transport'] ?? 'mail');
    $from = (string)($mail['from'] ?? '');
    $fromName = (string)($mail['from_name'] ?? 'Wirefragma');
    if ($from === '') $from = 'no-reply@' . preg_replace('/^www\./', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));

    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encodedFrom = '=?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>';
    $headers = [
        'From' => $encodedFrom,
        'Reply-To' => $from,
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'base64',
        'X-Mailer' => 'Wirefragma',
    ];
    $body = chunk_split(base64_encode($text));

    if ($transport === 'log') {
        $file = (string)($mail['log_file'] ?? (sys_get_temp_dir() . '/wirefragma-mail.log'));
        $entry = sprintf("==== %s\nTo: %s\nSubject: %s\n\n%s\n\n", gmdate('c'), $to, $subject, $text);
        return file_put_contents($file, $entry, FILE_APPEND | LOCK_EX) !== false;
    }

    if ($transport === 'smtp') {
        return wf_smtp_send($mail['smtp'] ?? [], $from, $to, $encodedSubject, $headers, $body);
    }

    $headerLines = '';
    foreach ($headers as $name => $value) $headerLines .= "{$name}: {$value}\r\n";
    // -f sets the envelope sender, which improves deliverability on cPanel hosts.
    return @mail($to, $encodedSubject, $body, rtrim($headerLines), '-f' . $from);
}

function wf_smtp_send(array $smtp, string $from, string $to, string $subject, array $headers, string $body): bool
{
    $host = (string)($smtp['host'] ?? '');
    $port = (int)($smtp['port'] ?? 465);
    $secure = (string)($smtp['secure'] ?? 'ssl');
    if ($host === '') return false;

    $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $socket = @stream_socket_client($remote, $errno, $errstr, 12);
    if (!$socket) return false;
    stream_set_timeout($socket, 12);

    $read = static function () use ($socket): string {
        $response = '';
        while (($line = fgets($socket, 515)) !== false) {
            $response .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;
        }
        return $response;
    };
    $command = static function (string $line, array $expect) use ($socket, $read): bool {
        if ($line !== '') fwrite($socket, $line . "\r\n");
        $response = $read();
        return in_array((int)substr($response, 0, 3), $expect, true);
    };

    $ehloHost = (string)($_SERVER['SERVER_NAME'] ?? 'localhost');
    $ok = $command('', [220]) && $command('EHLO ' . $ehloHost, [250]);
    if ($ok && $secure === 'tls') {
        $ok = $command('STARTTLS', [220])
            && stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)
            && $command('EHLO ' . $ehloHost, [250]);
    }
    if ($ok && !empty($smtp['user'])) {
        $ok = $command('AUTH LOGIN', [334])
            && $command(base64_encode((string)$smtp['user']), [334])
            && $command(base64_encode((string)($smtp['pass'] ?? '')), [235]);
    }
    $ok = $ok && $command('MAIL FROM:<' . $from . '>', [250]) && $command('RCPT TO:<' . $to . '>', [250, 251]);
    if ($ok) {
        $message = 'To: <' . $to . ">\r\nSubject: " . $subject . "\r\nDate: " . date('r') . "\r\n";
        $message .= 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (explode('@', $from)[1] ?? 'localhost') . ">\r\n";
        foreach ($headers as $name => $value) $message .= "{$name}: {$value}\r\n";
        $message .= "\r\n" . str_replace("\n.", "\n..", $body) . "\r\n.";
        $ok = $command('DATA', [354]) && $command($message, [250]);
    }
    fwrite($socket, "QUIT\r\n");
    fclose($socket);
    return $ok;
}

function wf_mail_verify(string $to, string $token): bool
{
    $link = wf_app_url('verify=' . rawurlencode($token));
    $text = "Welcome to Wirefragma!\n\n"
        . "Please confirm your email address to activate your account:\n\n"
        . $link . "\n\n"
        . "The link is valid for 48 hours. If you did not create an account, just ignore this email.\n";
    return wf_send_mail($to, 'Confirm your Wirefragma account', $text);
}

function wf_mail_reset(string $to, string $token): bool
{
    $link = wf_app_url('reset=' . rawurlencode($token));
    $text = "Someone (hopefully you) asked to reset the password of your Wirefragma account.\n\n"
        . "Choose a new password here:\n\n"
        . $link . "\n\n"
        . "The link is valid for 1 hour. If you did not ask for this, you can ignore this email — your password stays the same.\n";
    return wf_send_mail($to, 'Reset your Wirefragma password', $text);
}

function wf_mail_already_registered(string $to): bool
{
    $link = wf_app_url('forgot=1');
    $text = "Someone tried to create a Wirefragma account with this email address, but you already have one.\n\n"
        . "If it was you, simply sign in. Forgot your password? Reset it here:\n\n"
        . $link . "\n\n"
        . "If it was not you, no action is needed.\n";
    return wf_send_mail($to, 'You already have a Wirefragma account', $text);
}
