# Marketing Agent WordPress Bridge

Copy this directory into `wp-content/plugins/`, activate the plugin and connect with an administrator Application Password over HTTPS. Requires WordPress 6.5+, PHP 8+. REST namespace: `marketing-agent/v1`, protocol 1. Every endpoint requires `manage_options`; writes also check operation-specific WordPress capabilities.

See [installation, supported adapters and backup limitations](../../docs/wordpress.md). This plugin intentionally has no arbitrary PHP, shell or HTTP execution endpoint. Keep WordPress, this bridge and UpdraftPlus updated. Test changes on staging first.
