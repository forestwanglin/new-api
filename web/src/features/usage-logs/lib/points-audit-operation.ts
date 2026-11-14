/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
type Translate = (key: string, opts?: Record<string, unknown>) => string

// Points are decimal integer strings, never quota/currency or JavaScript Numbers.
function pointText(value: unknown, t: Translate): string {
  if (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)) return value
  return t('Not recorded')
}

export function buildPointsAuditOperation(
  action: string,
  params: Record<string, unknown>,
  success: boolean,
  t: Translate
) {
  let headline: string
  switch (action) {
    case 'user.points_add':
      headline = t('Increase user points')
      break
    case 'user.points_subtract':
      headline = t('Decrease user points')
      break
    case 'user.points_replay':
      headline = t('Replay point adjustment')
      break
    case 'user.points_adjust':
      headline = t('Adjust user points')
      break
    default:
      return null
  }
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : t('Not recorded')
  const id = text(params.target_user_id)
  const identifier = t('(ID: {{id}})', { id })
  const summary = t('{{operation}} (ID: {{id}})', { operation: headline, id })
  const name = text(params.point_type_name)
  const code = text(params.point_type_code)
  const type = `${name} (${code})`
  const amount = pointText(params.amount, t)
  let description = t('Point type: {{type}} · Points: {{points}}', {
    type,
    points: amount,
  })
  const requestID = text(params.adjustment_request_id)
  let mode = text(params.mode)
  if (params.mode === 'add') mode = t('Increase user points')
  else if (params.mode === 'subtract') mode = t('Decrease user points')
  const fields: { label: string; value: string; copyable?: boolean }[] = [
    { label: t('Target username'), value: text(params.target_username) },
    { label: t('User ID'), value: id, copyable: true },
    { label: t('Point type'), value: type },
    {
      label: t('Point type ID'),
      value: text(params.point_type_id),
      copyable: true,
    },
    { label: t('Adjustment mode'), value: mode },
    { label: t('Points'), value: amount },
    {
      label: t('Point adjustment request ID'),
      value: requestID,
      copyable: true,
    },
  ]
  if (success) {
    const before = pointText(params.from, t)
    const after = pointText(params.to, t)
    description = `${description} · ${before} → ${after}`
    fields.push(
      { label: t('Points before adjustment'), value: before },
      { label: t('Points after adjustment'), value: after }
    )
    if (action === 'user.points_replay') {
      description = `${description} · ${t('No additional points were changed')}`
    }
  } else {
    const reasons: Record<string, string> = {
      invalid_parameters: t('Invalid point adjustment parameters'),
      request_conflict: t(
        'Point adjustment request conflicts with an existing request'
      ),
      points_overflow: t('Point balance exceeds the supported integer range'),
      point_type_not_found: t('Point type not found'),
      permission_denied: t('Insufficient permission to adjust this user'),
      target_not_found: t('Target user not found'),
      database_error: t('Failed to adjust user points'),
    }
    const reason =
      typeof params.failure_reason === 'string'
        ? reasons[params.failure_reason]
        : undefined
    if (reason) description = `${description} · ${reason}`
    fields.push({
      label: t('Failure reason'),
      value: reason || t('Not recorded'),
    })
  }
  return { headline, summary, identifier, description, fields }
}
