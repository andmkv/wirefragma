<?php
/**
 * Captcha for sign-up and password reset.
 *
 * - `builtin`: a self-hosted distorted-text PNG rendered with GD (bundled with PHP on Namecheap).
 *   The answer lives only in the PHP session, is single-use and expires after 10 minutes.
 *   Without GD it degrades to a small arithmetic question.
 * - `turnstile`: Cloudflare Turnstile, verified server-side with the secret key.
 */

declare(strict_types=1);

const WF_CAPTCHA_TTL = 600;
const WF_CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';

function wf_captcha_provider(): string
{
    $captcha = wf_config()['captcha'] ?? [];
    $provider = (string)($captcha['provider'] ?? 'builtin');
    if ($provider === 'turnstile' && !empty($captcha['turnstile_site_key']) && !empty($captcha['turnstile_secret'])) {
        return 'turnstile';
    }
    return 'builtin';
}

/** Public captcha settings for the client. */
function wf_captcha_public(): array
{
    $provider = wf_captcha_provider();
    return [
        'provider' => $provider,
        'siteKey' => $provider === 'turnstile' ? (string)wf_config()['captcha']['turnstile_site_key'] : null,
    ];
}

/** New built-in challenge: returns ['image' => data URL] or ['question' => text]. */
function wf_captcha_new(): array
{
    if (!function_exists('imagecreatetruecolor')) {
        $a = random_int(2, 9);
        $b = random_int(2, 9);
        $_SESSION['captcha'] = ['answer' => (string)($a + $b), 'expires' => time() + WF_CAPTCHA_TTL];
        return ['image' => null, 'question' => "What is {$a} + {$b}?"];
    }

    $length = 5;
    $answer = '';
    for ($i = 0; $i < $length; $i++) {
        $answer .= WF_CAPTCHA_ALPHABET[random_int(0, strlen(WF_CAPTCHA_ALPHABET) - 1)];
    }
    $_SESSION['captcha'] = ['answer' => $answer, 'expires' => time() + WF_CAPTCHA_TTL];

    $width = 220;
    $height = 72;
    $image = imagecreatetruecolor($width, $height);
    $background = imagecolorallocate($image, 246, 247, 249);
    imagefilledrectangle($image, 0, 0, $width, $height, $background);

    // Faint grid, like the editor canvas.
    $grid = imagecolorallocate($image, 226, 229, 234);
    for ($x = 0; $x < $width; $x += 12) imageline($image, $x, 0, $x, $height, $grid);
    for ($y = 0; $y < $height; $y += 12) imageline($image, 0, $y, $width, $y, $grid);

    // Each glyph: GD's built-in font 5, upscaled and rotated so it is not machine-trivial.
    $cell = (int)floor(($width - 20) / $length);
    for ($i = 0; $i < $length; $i++) {
        $glyph = imagecreatetruecolor(10, 16);
        $white = imagecolorallocate($glyph, 255, 255, 255);
        imagefilledrectangle($glyph, 0, 0, 10, 16, $white);
        imagecolortransparent($glyph, $white);
        $ink = imagecolorallocate($glyph, random_int(20, 70), random_int(30, 70), random_int(40, 90));
        imagestring($glyph, 5, 1, 0, $answer[$i], $ink);

        $scale = random_int(30, 36) / 10;
        $scaled = imagecreatetruecolor((int)(10 * $scale), (int)(16 * $scale));
        $sw = imagecolorallocate($scaled, 255, 255, 255);
        imagefilledrectangle($scaled, 0, 0, (int)(10 * $scale), (int)(16 * $scale), $sw);
        imagecopyresampled($scaled, $glyph, 0, 0, 0, 0, (int)(10 * $scale), (int)(16 * $scale), 10, 16);
        $rotated = imagerotate($scaled, random_int(-22, 22), $sw);
        imagecolortransparent($rotated, imagecolorallocate($rotated, 255, 255, 255));

        $gx = 10 + $i * $cell + random_int(-3, 5);
        $gy = (int)(($height - imagesy($rotated)) / 2) + random_int(-6, 6);
        imagecopymerge($image, $rotated, $gx, $gy, 0, 0, imagesx($rotated), imagesy($rotated), 100);
    }

    // Noise strokes across the glyphs.
    for ($i = 0; $i < 5; $i++) {
        $noise = imagecolorallocate($image, random_int(60, 150), random_int(80, 150), random_int(120, 200));
        imagesetthickness($image, random_int(1, 2));
        imagearc(
            $image,
            random_int(0, $width),
            random_int(0, $height),
            random_int(120, 320),
            random_int(40, 120),
            random_int(0, 360),
            random_int(0, 360),
            $noise
        );
    }
    for ($i = 0; $i < 220; $i++) {
        $dot = imagecolorallocate($image, random_int(90, 200), random_int(90, 200), random_int(90, 200));
        imagesetpixel($image, random_int(0, $width - 1), random_int(0, $height - 1), $dot);
    }

    ob_start();
    imagepng($image);
    $png = (string)ob_get_clean();
    return ['image' => 'data:image/png;base64,' . base64_encode($png), 'question' => null];
}

/** Verify (and consume) the captcha answer sent with a form. */
function wf_captcha_verify(array $input): void
{
    if (wf_captcha_provider() === 'turnstile') {
        $token = wf_str($input, 'captcha', 4096);
        if ($token === '' || !wf_turnstile_ok($token)) {
            throw new ApiError(400, 'captcha', 'The captcha check failed. Please try again.');
        }
        return;
    }

    $expected = $_SESSION['captcha'] ?? null;
    unset($_SESSION['captcha']); // single use, right or wrong
    $answer = strtoupper(str_replace(' ', '', wf_str($input, 'captcha', 20)));
    if (
        !is_array($expected) ||
        ($expected['expires'] ?? 0) < time() ||
        $answer === '' ||
        !hash_equals((string)$expected['answer'], $answer)
    ) {
        throw new ApiError(400, 'captcha', 'The characters did not match. A new image was generated — please try again.');
    }
}

function wf_turnstile_ok(string $token): bool
{
    $body = http_build_query([
        'secret' => (string)wf_config()['captcha']['turnstile_secret'],
        'response' => $token,
        'remoteip' => wf_client_ip(),
    ]);
    $url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    $response = false;
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
        ]);
        $response = curl_exec($curl);
        curl_close($curl);
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $body,
            'timeout' => 8,
        ]]);
        $response = @file_get_contents($url, false, $context);
    }
    if (!is_string($response)) return false;
    $decoded = json_decode($response, true);
    return is_array($decoded) && ($decoded['success'] ?? false) === true;
}
