#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fixture_project="ma-wordpress-fixture-$$"
fixture_key="$(mktemp)"
chmod 600 "$fixture_key"
compose=(docker compose -p "$fixture_project" -f tests/wordpress/compose.yml)
cleanup() {
  rm -f "$fixture_key"
  "${compose[@]}" down -v --remove-orphans >/dev/null
}
trap cleanup EXIT
"${compose[@]}" up -d --wait db wordpress
for attempt in {1..30}; do
  if "${compose[@]}" run --rm cli wp core version >/dev/null 2>&1; then break; fi
  sleep 2
done
"${compose[@]}" run --rm cli wp core install --url=http://127.0.0.1:8097 --title='WordPress fixture' --admin_user=fixture --admin_password=fixture-password-123 --admin_email=fixture@example.test --skip-email
"${compose[@]}" run --rm cli wp rewrite structure '/%postname%/' --hard
"${compose[@]}" run --rm cli wp plugin activate marketing-agent-wordpress
"${compose[@]}" run --rm cli wp plugin install wordpress-seo --version=26.0 --activate
"${compose[@]}" run --rm cli wp plugin install seo-by-rank-math --version=1.0.280 --activate
"${compose[@]}" run --rm cli wp plugin install updraftplus --version=1.26.13 --activate
"${compose[@]}" run --rm cli wp plugin install elementor --version=4.3.5 --activate
"${compose[@]}" run --rm cli wp user application-password create fixture fixture-test --porcelain > "$fixture_key"
"${compose[@]}" exec -T wordpress php -l /var/www/html/wp-content/plugins/marketing-agent-wordpress/marketing-agent-wordpress.php
WORDPRESS_TEST_KEY_FILE="$fixture_key" pnpm vitest run packages/tools/tests/wordpress-live.test.ts
