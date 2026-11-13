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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  TutorialEntity,
  TutorialFilters,
  TutorialGroup,
  TutorialGroupInput,
  TutorialChapter,
  TutorialChapterInput,
  TutorialChapterSummary,
  TutorialList,
} from './types'

type Response<T> = { success: boolean; message?: string; data: T }
const base = '/api/config_tutorial/admin'
export const tutorialKeys = {
  all: (viewer: string) => ['tutorial-management', viewer] as const,
  list: (viewer: string, entity: TutorialEntity, filters: TutorialFilters) =>
    ['tutorial-management', viewer, entity, 'list', filters] as const,
  detail: (viewer: string, entity: TutorialEntity, id: string) =>
    ['tutorial-management', viewer, entity, 'detail', id] as const,
}
export async function listTutorialGroups(
  filters: TutorialFilters
): Promise<TutorialList<TutorialGroup>> {
  const { p, page_size, keyword } = filters
  const response = await api.get<Response<TutorialList<TutorialGroup>>>(
    `${base}/groups`,
    { params: { p, page_size, ...(keyword ? { keyword } : {}) } }
  )
  return requireServerSuccess(response.data).data
}
export async function listTutorialChapters(
  filters: TutorialFilters
): Promise<TutorialList<TutorialChapterSummary>> {
  const response = await api.get<
    Response<TutorialList<TutorialChapterSummary>>
  >(`${base}/chapters`, { params: filters })
  return requireServerSuccess(response.data).data
}
export async function getTutorialGroup(id: string): Promise<TutorialGroup> {
  const response = await api.get<Response<TutorialGroup>>(
    `${base}/groups/${id}`
  )
  return requireServerSuccess(response.data).data
}
export async function getTutorialChapter(id: string): Promise<TutorialChapter> {
  const response = await api.get<Response<TutorialChapter>>(
    `${base}/chapters/${id}`
  )
  return requireServerSuccess(response.data).data
}
export async function saveTutorialGroup(
  input: TutorialGroupInput,
  current?: { id: string; version: string }
): Promise<TutorialGroup> {
  const body = {
    title: input.title,
    sort_order: input.sort_order,
    enabled: input.enabled,
  }
  const response = current
    ? await api.put<Response<TutorialGroup>>(`${base}/groups/${current.id}`, {
        ...body,
        version: current.version,
      })
    : await api.post<Response<TutorialGroup>>(`${base}/groups`, {
        ...body,
        group_key: input.group_key,
      })
  return requireServerSuccess(response.data).data
}
export async function saveTutorialChapter(
  input: TutorialChapterInput,
  current?: { id: string; version: string }
): Promise<TutorialChapter> {
  const body = {
    group_id: input.group_id,
    title: input.title,
    content_markdown: input.content_markdown,
    sort_order: input.sort_order,
    enabled: input.enabled,
  }
  const response = current
    ? await api.put<Response<TutorialChapter>>(
        `${base}/chapters/${current.id}`,
        { ...body, version: current.version }
      )
    : await api.post<Response<TutorialChapter>>(`${base}/chapters`, {
        ...body,
        anchor: input.anchor,
      })
  return requireServerSuccess(response.data).data
}
export async function deleteTutorialItem(
  entity: TutorialEntity,
  id: string
): Promise<void> {
  const response = await api.delete<Response<null>>(`${base}/${entity}/${id}`)
  requireServerSuccess(response.data)
}
