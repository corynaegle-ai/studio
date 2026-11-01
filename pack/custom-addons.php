<?php
// SPDX-License-Identifier: Apache-2.0
/**
 * custom-addons.php — the Library side of a custom build (0.8 AL.18; spec § 12.2): for each add-on a config names, decide whether it may go
 * inside the organisation's build and, if so, print its files. Prints JSON; run as www-data: sudo -u www-data env CADCRAFT_SITE=<site> php custom-addons.php <ids.json>
 *   input  ids.json = {"seats": n|null, "addons": [{"id": "...", "version": "x.y.z"|null}]}
 *   output {"items": [{id, version, first_party, class, apps[], files{path: base64}, maker, paid, price_model, price_label, sha256}],
 *           "refused": [{id, why}]}
 * First-party add-ons are not fetched (their code is in the app builds already; the packer checks it is there). Outside makers' items need their
 * bundling licence (AddonBundling), a published, reviewed package and — for paid items — they are listed in the statement for the owner
 * (price, seats): this script charges nobody. Examples and engines-in-the-library are refused/ignored by the same rules as the Library.
 */
declare(strict_types=1);
$site = getenv('CADCRAFT_SITE') ?: '';
if ($site === '') { fwrite(STDERR, "CADCRAFT_SITE is not set\n"); exit(1); }
require_once $site . '/public_html/core/bootstrap.php';
$in = json_decode((string)file_get_contents($argv[1] ?? 'php://stdin'), true);
if (!is_array($in) || !is_array($in['addons'] ?? null)) { fwrite(STDERR, "bad input\n"); exit(1); }
$items = []; $refused = [];
// Listings name apps by RoadmapCatalog key ('cad'); builds and manifests by Catalog slug ('cadcraft').
$slugsOf = static fn(array $keys): array => array_values(array_filter(Catalog::slugs(), static fn($s) => in_array(RoadmapCatalog::keyForSlug($s), $keys, true)));
foreach ($in['addons'] as $want) {
    $id = (string)($want['id'] ?? '');
    $l = AddonLibrary::byListingId($id);
    if (!$l) { $refused[] = ['id' => $id, 'why' => 'No such add-on in the Library.']; continue; }
    if ($l['first_party']) { $items[] = ['id' => $id, 'first_party' => true, 'version' => null, 'class' => $l['class'], 'apps' => $slugsOf($l['apps']), 'files' => new stdClass, 'maker' => 'CadCraft', 'paid' => false, 'price_model' => 'free', 'price_label' => 'Free', 'sha256' => null]; continue; }
    $ok = AddonBundling::allowed($l);
    if (!$ok['ok']) { $refused[] = ['id' => $id, 'why' => $ok['why']]; continue; }
    $a = Addons::byAddonId($id);
    if (!$a) { $refused[] = ['id' => $id, 'why' => 'It has no package yet (planned or example).']; continue; }
    $v = (string)($want['version'] ?? '');
    if ($v === '') { $la = Addons::latestApproved((int)$a['id']); $v = $la['version'] ?? ''; }
    $json = $v !== '' ? Addons::packageFor($id, $v, null) : null;   // null viewer: published versions only, signed
    if ($json === null) { $refused[] = ['id' => $id, 'why' => "No published version" . ($v !== '' ? " $v" : '') . '.']; continue; }
    $pkg = json_decode($json, true);
    $m = $pkg['manifest'] ?? [];
    $mk = Makers::byUser((int)$l['maker_user_id']);
    $items[] = ['id' => $id, 'first_party' => false, 'version' => $v, 'class' => $l['class'], 'apps' => array_values((array)($m['apps'] ?? $slugsOf($l['apps']))),
                'files' => $pkg['files'], 'maker' => $mk['display_name'] ?? 'maker', 'paid' => (bool)$l['paid'], 'price_model' => $l['price_model'],
                'price_label' => AddonLibrary::priceLabel($l), 'sha256' => hash('sha256', $json)];
}
// AL.18 (owner decision 2026-10-30): a custom build = a setup fee + a yearly rebuild fee. The amounts are the owner's: .env ADDON_CUSTOM_SETUP_FEE_CENTS and
// ADDON_CUSTOM_REBUILD_FEE_CENTS (unset = not priced yet, said so in the statement). Nothing is charged here.
$fee = static fn(string $k) => ($v = env($k, '')) !== '' && ctype_digit((string)$v) ? (int)$v : null;
echo json_encode(['items' => $items, 'refused' => $refused, 'fees' => ['setup_cents' => $fee('ADDON_CUSTOM_SETUP_FEE_CENTS'), 'rebuild_yearly_cents' => $fee('ADDON_CUSTOM_REBUILD_FEE_CENTS'), 'currency' => 'USD']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
