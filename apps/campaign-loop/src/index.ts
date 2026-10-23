/**
 * CampaignLoop product boundary.
 *
 * The HTTP server owns authentication and transport; this small package keeps
 * the product name and domain dependency discoverable for deployments that want
 * to mount the campaign surface separately from the main marketing UI.
 */
export const CAMPAIGN_LOOP_VERSION = '0.1.0'

export * from '@marketing-agent/campaign-domain'
