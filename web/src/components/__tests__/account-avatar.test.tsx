import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { useAuthStore, type AuthUser } from '@/stores/auth-store'

import { MobileDrawer } from '../layout/components/mobile-drawer'
import { ProfileDropdown } from '../profile-dropdown'

const user: AuthUser = {
  id: 1,
  username: 'alice',
  display_name: 'Alice',
  role: 1,
  avatar_url: 'https://example.com/avatar',
}

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

async function showEntry(
  mobile: boolean,
  avatar: string | undefined,
  load: boolean
) {
  const images: HTMLImageElement[] = []
  const OriginalImage = window.Image
  vi.stubGlobal(
    'Image',
    class extends OriginalImage {
      constructor() {
        super()
        images.push(this)
      }
    }
  )
  const currentUser = {
    ...user,
    avatar_url: avatar,
    sidebar_modules: JSON.stringify({
      personal: { enabled: true, topup: true },
    }),
  }
  useAuthStore.getState().auth.setUser(currentUser)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    SidebarModulesAdmin: JSON.stringify({
      personal: { enabled: true, topup: true },
    }),
  })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () =>
        mobile ? (
          <MobileDrawer
            isOpen
            onClose={() => undefined}
            homeUrl='/'
            displayLogo={null}
            displaySiteName='Site'
            loading={false}
            logoLoaded
            mobileLinksList={[]}
            showAuthButtons
            user={currentUser}
          />
        ) : (
          <ProfileDropdown />
        ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  if (avatar) {
    await waitFor(() => expect(images.length).toBeGreaterThan(0))
    await act(async () => {
      for (const image of images) {
        image.dispatchEvent(new Event(load ? 'load' : 'error'))
      }
    })
  }
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} entry hides the retired wallet despite saved true preferences`, async () => {
    await showEntry(mobile, undefined, false)
    if (mobile) {
      expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
        'href',
        '/profile'
      )
      expect(
        screen.queryByRole('link', { name: 'Wallet' })
      ).not.toBeInTheDocument()
    } else {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button'))
      const menu = await screen.findByRole('menu')
      expect(
        within(menu).getByRole('menuitem', { name: 'Profile' })
      ).toBeVisible()
      expect(
        within(menu).queryByRole('menuitem', { name: 'Wallet' })
      ).not.toBeInTheDocument()
    }
  })
  test(`${mobile ? 'mobile' : 'desktop'} entry displays a loaded user avatar`, async () => {
    await showEntry(mobile, user.avatar_url, true)
    expect(await screen.findByRole('img', { name: '@Alice' })).toHaveAttribute(
      'src',
      user.avatar_url
    )
  })
  test(`${mobile ? 'mobile' : 'desktop'} entry preserves fallback when avatar fails`, async () => {
    await showEntry(mobile, user.avatar_url, false)
    expect(
      screen.queryByRole('img', { name: '@Alice' })
    ).not.toBeInTheDocument()
    expect(await screen.findByText('A', { exact: true })).toBeVisible()
  })
  test(`${mobile ? 'mobile' : 'desktop'} entry preserves fallback without an avatar`, async () => {
    await showEntry(mobile, undefined, false)
    expect(await screen.findByText('A', { exact: true })).toBeVisible()
  })
}
