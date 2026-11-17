import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PersonalProfile } from '../index'

const profile = {
  id: 1,
  username: 'alice',
  display_name: 'Alice',
  role: 1,
  setting: '{}',
}
beforeEach(() => {
  useAuthStore.getState().auth.setUser(profile)
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status')
        ? {
            bound: true,
            phone_masked: '138****8000',
            verification_required: false,
          }
        : profile,
    },
  }))
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset('idle')
  vi.restoreAllMocks()
  void i18next.changeLanguage('en')
})

it('preserves the nickname draft through language saves and syncs later updates after nickname save', async () => {
  let savedProfile = { ...profile }
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status')
        ? {
            bound: true,
            phone_masked: '138****8000',
            verification_required: false,
          }
        : savedProfile,
    },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    const values = body as { language?: string; display_name?: string }
    savedProfile = {
      ...savedProfile,
      display_name: values.display_name ?? savedProfile.display_name,
      setting: JSON.stringify({ language: values.language ?? 'fr' }),
    }
    return { data: { success: true } }
  })
  const user = userEvent.setup()
  renderProfile()
  const nickname = await screen.findByLabelText('Nickname')
  await user.clear(nickname)
  await user.type(nickname, 'Draft nickname')
  await user.click(screen.getByLabelText('Preferred language'))
  await user.click(await screen.findByRole('option', { name: 'Français' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/self', { language: 'fr' })
  )
  await waitFor(() =>
    expect(
      vi.mocked(api.get).mock.calls.filter(([url]) => url === '/api/user/self')
    ).toHaveLength(2)
  )
  expect(nickname).toHaveValue('Draft nickname')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(useAuthStore.getState().auth.user?.display_name).toBe(
      'Draft nickname'
    )
  )
  savedProfile = { ...savedProfile, display_name: 'Updated elsewhere' }
  await user.click(screen.getByLabelText('Preferred language'))
  await user.click(await screen.findByRole('option', { name: 'English' }))
  await waitFor(() => expect(nickname).toHaveValue('Updated elsewhere'))
})
function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <PersonalProfile />
    </QueryClientProvider>
  )
}

it('loads the masked bound phone and keeps the unavailable avatar action focusable and inert', async () => {
  const user = userEvent.setup()
  renderProfile()
  expect(await screen.findByLabelText('Phone number')).toHaveValue(
    '138****8000'
  )
  expect(screen.queryByLabelText('Login email')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Invoice title')).not.toBeInTheDocument()
  const change = screen.getByRole('button', { name: 'Change avatar' })
  expect(change).toHaveAttribute('aria-disabled', 'true')
  await user.tab()
  expect(change).toHaveFocus()
  await waitFor(() => expect(change).toHaveAttribute('data-popup-open'))
  await user.click(change)
  expect(screen.queryByLabelText('Upload avatar')).not.toBeInTheDocument()
})

it('saves the nickname without clearing the username and updates the account name', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  renderProfile()
  const nickname = await screen.findByLabelText('Nickname')
  await user.clear(nickname)
  await user.type(nickname, 'New name')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/self', {
      username: 'alice',
      display_name: 'New name',
    })
  )
  expect(useAuthStore.getState().auth.user?.display_name).toBe('New name')
})

it('shows phone load failure as unavailable with a retry instead of displaying an unbound phone', async () => {
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: url.endsWith('/status')
      ? { success: false, message: 'Phone unavailable' }
      : { success: true, data: profile },
  }))
  renderProfile()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Failed to load phone number'
  )
  expect(screen.getByLabelText('Phone number')).toHaveValue(
    'Temporarily unavailable'
  )
  expect(
    screen.getByRole('button', { name: 'Bind phone number' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})
