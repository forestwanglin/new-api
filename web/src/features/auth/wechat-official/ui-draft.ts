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
import { useAuthStore } from '@/stores/auth-store'
// Only non-secret UI fields belong here. Never pass assertions, proofs or flows.
const prefix = 'wechat-official-ui:'
export function saveOfficialUIDraft(
  key: 'bind' | 'token-create' | 'token-action' | 'token-edit' | 'token-revoke',
  value: unknown
): void {
  try {
    sessionStorage.setItem(
      prefix + key,
      JSON.stringify({
        userId: useAuthStore.getState().auth.user?.id,
        sid: useAuthStore.getState().auth.session?.sid,
        deadline: Date.now() + 300000,
        value,
      })
    )
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
export function readOfficialUIDraft(
  key: 'bind' | 'token-create' | 'token-action' | 'token-edit' | 'token-revoke'
): unknown {
  try {
    const raw = sessionStorage.getItem(prefix + key)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (
      data.userId !== useAuthStore.getState().auth.user?.id ||
      !Number.isFinite(data.deadline) ||
      data.sid !== useAuthStore.getState().auth.session?.sid ||
      data.deadline < Date.now()
    ) {
      clearOfficialUIDraft(key)
      return null
    }
    return data.value
  } catch {
    return null
  }
}
export function clearOfficialUIDraft(
  key: 'bind' | 'token-create' | 'token-action' | 'token-edit' | 'token-revoke'
): void {
  try {
    sessionStorage.removeItem(prefix + key)
  } catch {
    /* Optional UI draft. */
  }
}
