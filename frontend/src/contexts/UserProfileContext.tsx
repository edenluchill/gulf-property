import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { UserProfile } from '../types/comparison'
import {
  loadUserProfile,
  saveUserProfile as saveProfileToStorage,
  clearUserProfile as clearProfileFromStorage,
} from '../lib/userProfile'

interface UserProfileContextValue {
  profile: UserProfile | null
  hasProfile: boolean
  saveProfile: (profile: Partial<UserProfile>) => UserProfile
  clearProfile: () => void
  isLoading: boolean
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null)

interface UserProfileProviderProps {
  children: ReactNode
}

export function UserProfileProvider({ children }: UserProfileProviderProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load profile on mount
  useEffect(() => {
    const stored = loadUserProfile()
    setProfile(stored)
    setIsLoading(false)
  }, [])

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'gulf-property-user-profile') {
        setProfile(loadUserProfile())
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const saveProfile = useCallback((newProfile: Partial<UserProfile>) => {
    const updated = saveProfileToStorage(newProfile)
    setProfile(updated)
    return updated
  }, [])

  const clearProfile = useCallback(() => {
    clearProfileFromStorage()
    setProfile(null)
  }, [])

  const value: UserProfileContextValue = {
    profile,
    hasProfile: profile !== null,
    saveProfile,
    clearProfile,
    isLoading,
  }

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  )
}

export function useUserProfile() {
  const context = useContext(UserProfileContext)
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider')
  }
  return context
}
