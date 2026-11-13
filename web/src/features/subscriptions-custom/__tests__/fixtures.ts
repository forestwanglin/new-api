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
export const configuredPlan = {
  id: '9007199254740993',
  title: '后台月付计划',
  subtitle: '来自后台的副标题',
  billing_cycle: 'month' as const,
  duration_months: 1,
  currency: 'CNY' as const,
  price_amount_minor: '12345',
  paid_points: '9007199254740993',
  paid_point_type: { id: '1', code: 'GENERAL', name: '通用积分' },
  bonus_points: '7',
  bonus_point_type: { id: '2', code: 'GPT', name: 'GPT积分' },
  auto_renew_enabled: true,
  auto_renew_bonus_bps: 1250,
  auto_bonus_point_type: { id: '2', code: 'GPT', name: 'GPT积分' },
  benefits: ['后台权益', '<script>literal</script>'],
}
export const yearlyPlan = {
  ...configuredPlan,
  id: '42',
  title: '后台年付计划',
  billing_cycle: 'year' as const,
  duration_months: 12,
  price_amount_minor: '9007199254740993',
  paid_points: '1234',
  bonus_points: '0',
  bonus_point_type: null,
  auto_renew_enabled: false,
  auto_renew_bonus_bps: 0,
  auto_bonus_point_type: null,
}
