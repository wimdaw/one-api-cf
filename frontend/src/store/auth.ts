import { create } from 'zustand'
import { apiClient } from '@/api/client'
import { clearScopedCacheByPrefix } from '@/lib/local-cache'
import { type UserSelfInfo } from '@/types'
import { clearAdminCredentials } from '@/lib/admin-auth'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  showAuthModal: boolean
  currentUser: UserSelfInfo | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  openAuthModal: () => void
  closeAuthModal: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  error: null,
  showAuthModal: false,
  currentUser: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null })

    try {
      await apiClient.userLogin(username, password)
      clearAdminCredentials()
      set({ isAuthenticated: true, isLoading: false, showAuthModal: false, error: null })
      // 尝试拉取当前用户信息 (非关键, 失败不阻断)
      try {
        const self = await apiClient.getCurrentUser()
        set({ currentUser: self.data as UserSelfInfo })
      } catch {
        // ignore
      }
    } catch (error) {
      clearAdminCredentials()
      set({
        isAuthenticated: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      })
      throw error
    }
  },

  logout: async () => {
    try {
      await apiClient.logoutUser()
    } catch {
      // ignore logout errors and clear local state anyway
    }

    clearScopedCacheByPrefix('analytics:')
    clearScopedCacheByPrefix('usage-logs:')
    clearAdminCredentials()
    set({ isAuthenticated: false, error: null, currentUser: null })
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      clearAdminCredentials()
      await apiClient.checkAuth()
      set({ isAuthenticated: true, isLoading: false })
    } catch (error) {
      clearAdminCredentials()
      set({ isAuthenticated: false, isLoading: false })
    }
  },

  openAuthModal: () => set({ showAuthModal: true }),
  closeAuthModal: () => set({ showAuthModal: false }),
}))