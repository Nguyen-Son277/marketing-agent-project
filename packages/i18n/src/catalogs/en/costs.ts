/**
 * Namespace `costs` cho catalog tiếng Anh.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `costs.` để không đụng namespace khác.
 *
 * Bốn trạng thái lượt chạy dùng lại `taskStatus.*` để hai màn hình không lệch chữ khi
 * sửa một bên; chỉ `budget_exceeded` cần khoá riêng vì `taskStatus` không có.
 *
 * Tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín hiệu số
 * ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other` không tồn tại trong catalog phẳng.
 */
export const en_costs = {
  'costs.budgetExceeded': 'Budget exceeded',
  'costs.loading': 'Aggregating costs…',
  'costs.subtitle':
    'Costs by day, by agent, and per run. Pick a date range to narrow things down.',
  'costs.finishSetup': 'Open “Settings” to declare providers and models first.',

  'costs.range': 'Date range',
  'costs.rangeHint': 'Leave empty to include all stored data.',
  'costs.from': 'From',
  'costs.to': 'To',
  'costs.view': 'View',
  'costs.clearFilter': 'Clear filter',
  'costs.filtering': 'Filtering: {{from}} → {{to}}',
  'costs.rangeStart': 'beginning',
  'costs.rangeEnd': 'now',

  'costs.noValue': '—',
  'costs.totalCost': 'Total cost',
  'costs.runs': 'Runs',
  'costs.runsHint': 'Times agents actually called a model',
  'costs.tokensIn': 'Input tokens',
  'costs.tokensOut': 'Output tokens',
  'costs.totalTokens': '{{n}} tokens total',

  'costs.byDay': 'By day',
  'costs.byDayHint':
    'All agents and models combined per day. The longest bar is the most expensive day.',
  'costs.day': 'Day',
  'costs.cost': 'Cost',
  'costs.share': 'Share',
  'costs.noData': 'No cost data in the selected range.',

  'costs.byAgent': 'By agent',
  'costs.byAgentHint':
    'Sorted by cost, highest first — the top agent is where to review the model first.',
  'costs.noAgentData': 'No agent spent anything in the selected range.',

  'costs.runsCardHint': 'Details of every model call, newest first.',
  'costs.time': 'Time',
  'costs.latency': 'Latency',
  'costs.steps': 'Steps',
  'costs.error': 'Error',
  'costs.empty': 'No cost data yet.',
} as const
