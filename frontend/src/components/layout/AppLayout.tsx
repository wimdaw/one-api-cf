import { ReactNode, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/auth'
import { useToast } from '@/components/ui/use-toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Menu, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const {
    login,
    showAuthModal,
    closeAuthModal,
    isAuthenticated,
    isLoading: isAuthLoading,
  } = useAuthStore()
  const { addToast } = useToast()

  const resetAuthDialog = () => {
    setUsername('')
    setPassword('')
    setAuthError('')
    setIsSubmitting(false)
  }

  const handleCloseAuthModal = () => {
    resetAuthDialog()
    closeAuthModal()
  }

  const finalizeLogin = () => {
    resetAuthDialog()
    setIsMobileNavOpen(false)
    addToast(t('auth.loginSuccess'), 'success')
    navigate('/dashboard', { replace: true })
  }

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setIsSubmitting(true)

    try {
      await login(username.trim(), password)
      finalizeLogin()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t('auth.loginFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex">
      {isAuthenticated && !isAuthLoading && (
        <Sidebar
          className="hidden lg:flex sticky top-0 h-screen overflow-hidden"
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          showCollapseToggle
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {isAuthenticated && !isAuthLoading && (
          <header className="flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4 py-2.5 lg:hidden sticky top-0 z-30">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label={t('sidebar.openSidebar')}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-semibold text-sm tracking-tight">AI Gateway</span>
            </div>
            <div className="h-9 w-9" />
          </header>
        )}

        <main className="flex-1 bg-background gradient-mesh grid-pattern">
          <div className="mx-auto max-w-7xl w-full">
            {children}
          </div>
        </main>
      </div>

      {isAuthenticated && !isAuthLoading && isMobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl">
            <Sidebar
              onNavigate={() => setIsMobileNavOpen(false)}
              onClose={() => setIsMobileNavOpen(false)}
              collapsed={false}
              showCollapseToggle={false}
            />
          </div>
        </div>
      )}

      {/* Auth Dialog */}
      <Dialog open={showAuthModal} onOpenChange={(open) => !open && handleCloseAuthModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.title')}</DialogTitle>
            <DialogDescription>{t('auth.descLogin')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAuthSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="block" htmlFor="username">{t('auth.usernameLabel')}</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder={t('auth.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="block" htmlFor="password">{t('auth.passwordLabel')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {authError && (
                <Alert variant="destructive">
                  <AlertDescription>{authError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="mt-6 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseAuthModal}
                className='mr-0'
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('auth.sending') : t('auth.login')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
