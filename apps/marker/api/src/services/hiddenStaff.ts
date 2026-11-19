// A staff account with users.hidden set is kept out of every list other people see and is shown as "Administrator"
// wherever its email or name would appear beside marks, assignments or activity. Use these SQL fragments wherever a
// query returns a staff member's email or name, and `.where('hidden', false)` for lists of staff.
export const HIDDEN_LABEL = 'Administrator';

/** SQL for the email to show for the users row aliased `alias` */
export const shownEmail = (alias = 'u'): string => `CASE WHEN ${alias}.hidden THEN '${HIDDEN_LABEL}' ELSE ${alias}.email END`;

/** SQL for the name to show: null for a hidden account, so screens fall back to the email (which is the label) */
export const shownName = (alias = 'u'): string => `CASE WHEN ${alias}.hidden THEN NULL ELSE ${alias}.name END`;
