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
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Markdown } from '@/components/ui/markdown'

export function TutorialContent(props: { content: string }) {
  const { t } = useTranslation()
  const rendered = useMemo(
    () => <Markdown className='tutorial-markdown'>{props.content}</Markdown>,
    [props.content]
  )
  const root = useRef<HTMLDivElement>(null)
  const [copies, setCopies] = useState<
    { host: HTMLDivElement; value: string }[]
  >([])
  useLayoutEffect(() => {
    // The shared renderer owns parsing and sanitization. Only add React copy
    // controls beside its code blocks; never interpolate content into HTML.
    const blocks = [...(root.current?.querySelectorAll('pre') ?? [])]
    const next = blocks.map((block) => {
      const host = document.createElement('div')
      host.className = 'tutorial-code-actions'
      block.after(host)
      return {
        host,
        value:
          block.querySelector('code')?.textContent ?? block.textContent ?? '',
      }
    })
    setCopies(next)
    return () => {
      next.forEach((copy) => copy.host.remove())
    }
  }, [props.content])
  return (
    <div className='tutorial-content' ref={root}>
      {rendered}
      {copies.map((copy, index) =>
        createPortal(
          <CopyButton
            value={copy.value}
            size='sm'
            variant='outline'
            aria-label={t('Copy code')}
          >
            {t('Copy code')}
          </CopyButton>,
          copy.host,
          String(index)
        )
      )}
    </div>
  )
}
