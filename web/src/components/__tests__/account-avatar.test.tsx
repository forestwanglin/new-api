import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { pointsWalletKey } from '@/features/points-wallet/api'
import { customSubscriptionSelfKey } from '@/features/subscriptions-custom/api'
import { api } from '@/lib/api'
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
  load: boolean,
  overrides: Partial<AuthUser> = {},
  seedAccount = true
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
    ...overrides,
  }
  useAuthStore.getState().auth.setUser(currentUser)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (seedAccount) {
    client.setQueryData(pointsWalletKey(currentUser.id), {
      balances: [
        { code: 'GENERAL', available_points: '9007199254740993' },
        { code: 'GPT', available_points: '7' },
      ],
    })
    client.setQueryData(customSubscriptionSelfKey(currentUser.id), {
      active_subscription_id: '42',
      items: [
        {
          id: '42',
          status: 'active',
          plan_title: 'Team plan',
          billing_cycle: 'year',
        },
      ],
    })
  }
  client.setQueryData(['status'], {
    SidebarModulesAdmin: JSON.stringify({
      personal: { enabled: true, topup: true },
    }),
  })
  const root = createRootRoute({
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
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '/subscription' }),
    ]),
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
  return { client, router }
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

test('desktop account shows real points without precision loss and current subscription', async () => {
  await showEntry(false, undefined, false, { email: 'alice@example.com' })
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /Alice/ })
  expect(trigger).toHaveTextContent('9,007,199,254,741,000')
  await user.click(trigger)
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('alice@example.com')).toBeVisible()
  expect(within(menu).getByText('9,007,199,254,741,000')).toBeVisible()
  expect(within(menu).getByText('Team plan')).toBeVisible()
  expect(within(menu).getByText('Yearly')).toBeVisible()
  expect(within(menu).getByRole('menuitem', { name: 'Renew' })).toBeVisible()
  expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeVisible()
  expect(
    within(menu).getByRole('menuitem', { name: 'Security & Access' })
  ).toBeVisible()
  expect(
    within(menu).queryByRole('menuitem', { name: 'System Settings' })
  ).not.toBeInTheDocument()
  await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(
    'Are you sure you want to sign out?'
  )
})

test('desktop account preserves the super administrator menu', async () => {
  await showEntry(false, undefined, false, { role: 100 })
  await userEvent.setup().click(screen.getByRole('button'))
  expect(
    await screen.findByRole('menuitem', { name: 'System Settings' })
  ).toBeVisible()
})

test('desktop account respects hidden security and subscription modules', async () => {
  await showEntry(false, undefined, false, {
    sidebar_modules: JSON.stringify({
      personal: { security_access: false, my_subscription: false },
    }),
  })
  await userEvent.setup().click(screen.getByRole('button'))
  const menu = await screen.findByRole('menu')
  expect(
    within(menu).queryByText('Current subscription')
  ).not.toBeInTheDocument()
  expect(
    within(menu).queryByRole('menuitem', { name: 'Security & Access' })
  ).not.toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeVisible()
})

test('desktop account purchase action opens the existing subscription plans', async () => {
  const { client, router } = await showEntry(false, undefined, false)
  client.setQueryData(customSubscriptionSelfKey(user.id), {
    active_subscription_id: null,
    items: [],
  })
  const interaction = userEvent.setup()
  await interaction.click(screen.getByRole('button'))
  expect(await screen.findByText('No active subscription')).toBeVisible()
  await interaction.click(screen.getByRole('menuitem', { name: 'Buy' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/subscription')
  )
  expect(router.state.location.search).toEqual({ tab: 'plans' })
})

test('desktop account keeps menus usable without fabricating balances or subscription on request errors', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unavailable'))
  await showEntry(false, undefined, false, {}, false)
  const interaction = userEvent.setup()
  const trigger = screen.getByRole('button', { name: /Alice/ })
  expect(trigger).toHaveTextContent('—')
  await interaction.click(trigger)
  const menu = await screen.findByRole('menu')
  expect(await within(menu).findByText('Not available yet')).toBeVisible()
  expect(within(menu).getByText('—')).toBeVisible()
  expect(
    within(menu).queryByText('No active subscription')
  ).not.toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: 'Buy' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeVisible()
})
