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
      const response = await apiClient.userLogin(username, password)
      const loginData = (response.data as unknown) as UserSelfInfo
      clearAdminCredentials()
      set({
        isAuthenticated: true,
        isLoading: false,
        showAuthModal: false,
        error: null,
        currentUser: loginData as UserSelfInfo,
      })
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
      // 用用户自助端点验证会话并获取身份 (普通用户/管理员均可)
      const self = await apiClient.getUserProfile()
      set({
        isAuthenticated: true,
        isLoading: false,
        currentUser: self.data as UserSelfInfo,
      })
    } catch (error) {
      clearAdminCredentials()
      set({ isAuthenticated: false, isLoading: false, currentUser: null })
    }
  },

  openAuthModal: () => set({ showAuthModal: true }),
  closeAuthModal: () => set({ showAuthModal: false }),
}))