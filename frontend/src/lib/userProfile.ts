/**
 * User Profile Storage for AI Property Comparison
 *
 * Stores user preferences in localStorage for personalized recommendations
 */

import { UserProfile } from '../types/comparison'

const STORAGE_KEY = 'pinzos-user-profile'

/**
 * Load user profile from localStorage
 */
export function loadUserProfile(): UserProfile | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    const profile = JSON.parse(stored) as UserProfile
    return profile
  } catch (error) {
    console.error('Error loading user profile:', error)
    return null
  }
}

/**
 * Save user profile to localStorage
 */
export function saveUserProfile(profile: Partial<UserProfile>): UserProfile {
  const existing = loadUserProfile()
  const now = Date.now()

  const updated: UserProfile = {
    ...existing,
    ...profile,
    familyStatus: profile.familyStatus || existing?.familyStatus || 'single',
    purpose: profile.purpose || existing?.purpose || 'investment',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as UserProfile

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))

    // Dispatch storage event for cross-tab sync
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify(updated),
    }))
  } catch (error) {
    console.error('Error saving user profile:', error)
  }

  return updated
}

/**
 * Clear user profile from localStorage
 */
export function clearUserProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)

    // Dispatch storage event for cross-tab sync
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: null,
    }))
  } catch (error) {
    console.error('Error clearing user profile:', error)
  }
}

/**
 * Check if user has a saved profile
 */
export function hasUserProfile(): boolean {
  return loadUserProfile() !== null
}

/**
 * Get default profile values for form
 */
export function getDefaultProfile(): Partial<UserProfile> {
  return {
    familyStatus: 'single',
    purpose: 'investment',
    hasChildren: false,
    schoolPreference: false,
    commutePriority: false,
    budget: {
      min: 500000,
      max: 5000000,
    },
  }
}
