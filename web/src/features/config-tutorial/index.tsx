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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { SubscriptionsCustomFooter } from '@/features/subscriptions-custom/footer'
import { SupportDialog } from '@/features/subscriptions-custom/support-dialog'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getPublicTutorial, publicTutorialKey } from './api'
import { TutorialContent } from './components/tutorial-content'

import '@/styles/config-tutorial.css'

export function ConfigTutorial() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: publicTutorialKey,
    queryFn: getPublicTutorial,
    staleTime: 0,
  })
  const [active, setActive] = useState('')
  const [supportOpen, setSupportOpen] = useState(false)
  const selectChapter = (anchor: string) => {
    setActive(anchor)
    // Repeated clicks do not emit hashchange; restore the current chapter
    // after the reader has scrolled elsewhere in the continuous document.
    if (window.location.hash === `#${anchor}`) {
      document
        .querySelector(`[id="tutorial-${anchor}"]`)
        ?.scrollIntoView({ block: 'start' })
    }
  }
  useEffect(() => {
    const locate = () => {
      let anchor = ''
      try {
        anchor = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        return
      }
      const chapters =
        query.data?.groups.flatMap((group) => group.chapters) ?? []
      const selected = chapters.find((chapter) => chapter.anchor === anchor)
      setActive(selected?.anchor ?? chapters[0]?.anchor ?? '')
      if (selected) {
        document
          .querySelector(`[id="tutorial-${selected.anchor}"]`)
          ?.scrollIntoView({ block: 'start' })
      }
    }
    locate()
    window.addEventListener('hashchange', locate)
    return () => window.removeEventListener('hashchange', locate)
  }, [query.data])
  let content
  if (query.isPending) content = <LoadingState />
  else if (query.isError) {
    content = (
      <ErrorState
        description={getServerErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (!query.data.groups.length) {
    content = (
      <EmptyState
        title={t('No tutorials available')}
        description={t(
          'Tutorial content will appear here when it is available.'
        )}
      />
    )
  } else {
    content = (
      <div className='tutorial-document'>
        <nav className='tutorial-nav' aria-label={t('Tutorial contents')}>
          {query.data.groups.map((group) => (
            <div key={group.group_key} className='tutorial-nav-group'>
              <a
                className='tutorial-group-title'
                aria-current={
                  group.chapters[0]?.title === group.title &&
                  active === group.chapters[0]?.anchor
                    ? 'location'
                    : undefined
                }
                href={`#${group.chapters[0]?.anchor ?? ''}`}
                onClick={() => selectChapter(group.chapters[0]?.anchor ?? '')}
              >
                {group.title}
              </a>
              {group.chapters
                .filter(
                  (chapter, index) =>
                    index !== 0 || chapter.title !== group.title
                )
                .map((chapter) => (
                  <a
                    key={chapter.id}
                    href={`#${chapter.anchor}`}
                    className='tutorial-nav-link'
                    aria-current={
                      active === chapter.anchor ? 'location' : undefined
                    }
                    onClick={() => selectChapter(chapter.anchor)}
                  >
                    {chapter.title}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className='tutorial-body'>
          <header className='tutorial-intro'>
            <h1>{t('Configuration tutorial')}</h1>
            <p>
              {t(
                'Find setup instructions, code examples and common questions in the contents. Use your browser search to find keywords.'
              )}
            </p>
          </header>
          {query.data.groups
            .flatMap((group) => group.chapters)
            .map((chapter) => (
              <section
                className='tutorial-section'
                key={chapter.id}
                id={`tutorial-${chapter.anchor}`}
                aria-labelledby={`tutorial-heading-${chapter.id}`}
              >
                <h2 id={`tutorial-heading-${chapter.id}`}>{chapter.title}</h2>
                <TutorialContent content={chapter.content_markdown} />
              </section>
            ))}
        </div>
      </div>
    )
  }
  return (
    <PublicLayout showMainContainer={false}>
      <main className='config-tutorial'>
        <div className='tutorial-wrap'>{content}</div>
      </main>
      <SupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      <SubscriptionsCustomFooter onContact={() => setSupportOpen(true)} />
    </PublicLayout>
  )
}
