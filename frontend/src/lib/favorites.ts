const FAVORITES_KEY = 'gulf-property-favorites'

export function getFavorites(): string[] {
  const stored = localStorage.getItem(FAVORITES_KEY)
  return stored ? JSON.parse(stored) : []
}

export function addFavorite(projectId: string): void {
  const favorites = getFavorites()
  if (!favorites.includes(projectId)) {
    favorites.push(projectId)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  }
}

export function removeFavorite(projectId: string): void {
  const favorites = getFavorites()
  const filtered = favorites.filter(id => id !== projectId)
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(filtered))
}

export function isFavorite(projectId: string): boolean {
  return getFavorites().includes(projectId)
}
