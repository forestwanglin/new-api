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
export type TutorialEntity = 'groups' | 'chapters'
export interface TutorialGroupInput {
  group_key: string
  title: string
  sort_order: number
  enabled: boolean
}
export interface TutorialChapterInput {
  group_id: string
  anchor: string
  title: string
  content_markdown: string
  sort_order: number
  enabled: boolean
}
export interface TutorialGroup extends TutorialGroupInput {
  id: string
  version: string
  created_at: string
  updated_at: string
}
export interface TutorialChapter extends TutorialChapterInput {
  id: string
  version: string
  created_at: string
  updated_at: string
}
export type TutorialChapterSummary = Omit<TutorialChapter, 'content_markdown'>
export type TutorialRecord = TutorialGroup | TutorialChapterSummary
export interface TutorialFilters {
  p: number
  page_size: number
  keyword?: string
  group_id?: string
  enabled?: 'true' | 'false'
}
export interface TutorialList<T> {
  items: T[]
  total: number
  page?: number
  page_size?: number
}
export type TutorialSelection =
  | { mode: 'create' }
  | { mode: 'edit' | 'details'; id: string }
