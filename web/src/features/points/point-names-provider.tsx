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
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { getPointCatalog, pointsQueryKeys } from './api'
import { PointNamesContext } from './lib/point-name-context'

/** One directory read for the application, never one request per row or label. */
export function PointNamesProvider(props: { children: ReactNode }) {
  const query = useQuery({
    queryKey: pointsQueryKeys.catalog,
    queryFn: getPointCatalog,
    staleTime: 60_000,
    meta: { errorToast: false },
  })
  return (
    <PointNamesContext value={query.data ?? []}>
      {props.children}
    </PointNamesContext>
  )
}
