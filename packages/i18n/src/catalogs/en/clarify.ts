/**
 * Namespace `clarify` — clarification questions and their suggested answers.
 *
 * Option IDs (`objective-trial`, `scope-no-tiktok`, …) are IDENTICAL to the Vietnamese
 * catalog: the server maps a chosen option back to a brief field by that ID, so an ID must
 * never change when only the wording changes. Only the labels differ between locales.
 *
 * Wording choices:
 *  - "trial sign-up" for `dang ký dùng thử` — the product's own term.
 *  - "qualified lead" for `lead chất lượng`, matching the KPI documents in the demo data.
 *  - Money stays in VND because that is the currency the brief and the demo company use;
 *    converting it here would invent an exchange rate.
 */
export const en_clarify = {
  /* ------------------------------------------------------------ intro */
  'clarify.intro': 'Before I plan, I need to pin down a few points so the team does the right work:',
  'clarify.remaining': 'Still missing: {{fields}}',
  'clarify.improved': 'The suggestions below were written for this company’s context.',

  /* --------------------------------------------------------- objective */
  'clarify.objective.question': 'What business result do you ultimately want?',
  'clarify.objective.helper': 'Pick the closest result; add anything else in the free-text box.',
  'clarify.objective-trial.label': 'Increase trial sign-ups',
  'clarify.objective-trial.hint': 'Prioritise the number of new users.',
  'clarify.objective-lead.label': 'Increase qualified leads',
  'clarify.objective-lead.hint': 'Prioritise leads the sales team can work.',
  'clarify.objective-cpl.label': 'Reduce cost per lead (CPL)',
  'clarify.objective-cpl.hint': 'Keep the volume, cut the cost.',
  'clarify.objective-revenue.label': 'Increase revenue',
  'clarify.objective-revenue.hint': 'Tied to placed orders or signed contracts.',
  'clarify.objective-brand.label': 'Increase brand awareness',
  'clarify.objective-brand.hint': 'Prioritise reach and brand recall.',
  'clarify.objective-other.label': 'A different objective (I will describe it)',

  /* --------------------------------------------------------------- KPI */
  'clarify.kpi.question': 'Which metric defines success, and at what level?',
  'clarify.kpi.helper': 'State the number and the time window if you have one.',
  'clarify.kpi-leads.label': 'Leads per month',
  'clarify.kpi-cpl.label': 'Maximum CPL allowed',
  'clarify.kpi-signups.label': 'Trial sign-ups',
  'clarify.kpi-traffic.label': 'Traffic or search ranking',
  'clarify.kpi-engagement.label': 'Social engagement',
  'clarify.kpi-other.label': 'A different metric (I will describe it)',

  /* ------------------------------------------------------------- scope */
  'clarify.scope.question': 'What is in scope this time, and what is NOT?',
  'clarify.scope.helper': 'Multiple choices allowed. Items marked "not doing" are exclusions.',
  'clarify.scope-facebook.label': 'Run Facebook ads',
  'clarify.scope-seo.label': 'Do SEO and search content',
  'clarify.scope-social-organic.label': 'Run organic social posts',
  'clarify.scope-email.label': 'Email/CRM nurture sequence',
  'clarify.scope-no-tiktok.label': 'Not doing TikTok this time',
  'clarify.scope-no-influencer.label': 'Not hiring influencers/KOLs',
  'clarify.scope-no-ads.label': 'Not running paid ads',
  'clarify.scope-no-redesign.label': 'Not redesigning the website or brand',
  'clarify.scope-no-video.label': 'Not producing video',
  'clarify.scope-other.label': 'A different scope (I will describe it)',

  /* ---------------------------------------------------------- deadline */
  'clarify.deadline.question': 'When does it need to be done?',
  'clarify.deadline.helper': 'Pick the nearest milestone; note interim milestones in the free-text box.',
  'clarify.deadline-30.label': 'Within 30 days',
  'clarify.deadline-60.label': 'Within 60 days',
  'clarify.deadline-90.label': 'Within 90 days (one quarter)',
  'clarify.deadline-quarter-end.label': 'Before the end of this quarter',
  'clarify.deadline-year-end.label': 'Before the end of this year',
  'clarify.deadline-unknown.label': 'Not decided yet',
  'clarify.deadline-other.label': 'A different date (I will describe it)',

  /* ------------------------------------------------------------ budget */
  'clarify.budget.question': 'What is the budget for this round?',
  'clarify.budget.helper': 'Ad spend, people’s time, or both.',
  'clarify.budget-under-20m.label': 'Under 20 million VND',
  'clarify.budget-20-50m.label': '20–50 million VND',
  'clarify.budget-50-100m.label': '50–100 million VND',
  'clarify.budget-over-100m.label': 'Over 100 million VND',
  'clarify.budget-hours-only.label': 'Time only, no ad spend',
  'clarify.budget-unknown.label': 'Not decided yet',
  'clarify.budget-other.label': 'A different amount (I will describe it)',

  /* ------------------------------------------------------- constraints */
  'clarify.constraints.question': 'Are there any mandatory constraints?',
  'clarify.constraints.helper': 'Pick every constraint that must be respected; add detail in the free-text box.',
  'clarify.constraints-no-customer-photos.label': 'No customer photos without written consent',
  'clarify.constraints-no-unverified-claims.label': 'No unverified claims or promises',
  'clarify.constraints-brand-guidelines.label': 'Must follow the brand guidelines exactly',
  'clarify.constraints-legal-review.label': 'Content must pass legal review',
  'clarify.constraints-tone.label': 'Must keep the established brand tone',
  'clarify.constraints-none.label': 'No special constraints',
  'clarify.constraints-other.label': 'A different constraint (I will describe it)',

  /* --------------------------------------------------- free-text box */
  'clarify.customLabel': 'Your own answer',
  'clarify.customPlaceholder': 'Describe your answer to this question…',
  'clarify.customHint': 'Optional. You can pick a suggestion above and still add your own note.',
} as const
