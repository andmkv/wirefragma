<?php
/**
 * Wirefragma server configuration — TEMPLATE.
 *
 * Copy this file to ONE of these locations and fill it in (first match wins):
 *   1. the path in the WIREFRAGMA_CONFIG environment variable;
 *   2. two directories above this folder, named `wirefragma-config.php`
 *      (e.g. /home/USER/wirefragma-config.php when the app lives in /home/USER/public_html/) —
 *      RECOMMENDED: outside the web root, never downloadable;
 *   3. `config.php` next to this file (the bundled .htaccess blocks direct access to it).
 *
 * Never commit the real file: it holds your database and SMTP passwords.
 */

return [
    // MySQL / MariaDB (cPanel → MySQL Databases). Host is almost always "localhost" on Namecheap.
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'cpaneluser_wirefragma',
        'user' => 'cpaneluser_wfapp',
        'pass' => 'change-me',
    ],

    // Public URL of the folder that contains index.html, with a trailing slash.
    // Used to build the links in confirmation / password-reset emails.
    'app_url' => 'https://example.com/',

    'mail' => [
        // 'mail' = PHP mail() (works on Namecheap shared hosting out of the box),
        // 'smtp' = authenticated SMTP (better deliverability, e.g. Namecheap Private Email / cPanel mailbox),
        // 'log'  = write emails to `log_file` instead of sending (local development).
        'transport' => 'mail',
        'from' => 'no-reply@example.com',       // use an address on YOUR domain
        'from_name' => 'Wirefragma',
        'smtp' => [
            'host' => 'mail.example.com',
            'port' => 465,                      // 465 = implicit TLS, 587 = STARTTLS
            'secure' => 'ssl',                  // 'ssl' | 'tls' | ''
            'user' => 'no-reply@example.com',
            'pass' => 'change-me',
        ],
        'log_file' => __DIR__ . '/../mail.log',
    ],

    'captcha' => [
        // 'builtin'   = self-hosted image captcha (needs the GD extension; falls back to arithmetic),
        // 'turnstile' = Cloudflare Turnstile (free; create a widget at dash.cloudflare.com → Turnstile).
        'provider' => 'builtin',
        'turnstile_site_key' => '',
        'turnstile_secret' => '',
    ],

    // Shown in the privacy policy. Bump `version` when you change the policy text.
    'privacy' => [
        'version' => '2026-09-27',
        'operator' => 'Wirefragma',
        'contact_email' => 'privacy@example.com',
    ],

    // Set to false to stop new sign-ups (existing users can still sign in).
    'registration_open' => true,

    // Remote MCP endpoint (mcp/ next to api/; needs PHP 8.1+ and `npm run build:deploy`).
    // Everything is optional; see docs/mcp.md.
    'mcp' => [
        'enabled' => true,
        // Public URL shown in Settings. Default: app_url + "mcp/".
        'endpoint' => '',
        // Private, writable folder for MCP protocol sessions (NOT the PHP login sessions). Keep it
        // outside public_html, e.g. next to this file. Default: the system temp directory.
        'session_dir' => '',
        // Extra hostnames accepted in the Host / Origin header (DNS-rebinding protection). The
        // host of app_url, localhost, 127.0.0.1 and [::1] are always allowed.
        'allowed_hosts' => [],
        // Browser origins allowed to call the endpoint cross-origin (CORS). Empty = none, which
        // is right for MCP clients (they are not browsers). Never use '*'.
        'allowed_origins' => [],
    ],

    // Only for local development: adds error details to JSON responses.
    'debug' => false,
];
