/**
 * Luna Tour — global "demo/tour mode" flag.
 *
 * When active, the app chrome (Header / MobileNav / floating buttons) is hidden
 * and the map goes full-screen immersive. MapPage flips this on when the route
 * is /v/:code (a shared session) and off when leaving.
 *
 * ISOLATION: tiny context, no deps. Remove the Provider in App.tsx + the
 * useTourMode read in Layout.tsx + this file to delete.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface TourModeValue {
  active: boolean
  code: string | null
  enter: (code: string) => void
  exit: () => void
  /** When paused/asking, the real map tools are revealed so the customer can
   *  interact with the live map (§ user: 暂停时显示地图工具). */
  toolsRevealed: boolean
  setToolsRevealed: (b: boolean) => void
}

const TourModeContext = createContext<TourModeValue>({
  active: false,
  code: null,
  enter: () => {},
  exit: () => {},
  toolsRevealed: false,
  setToolsRevealed: () => {},
})

export function TourModeProvider({ children }: { children: React.ReactNode }) {
  const [code, setCode] = useState<string | null>(null)
  const [toolsRevealed, setToolsRevealed] = useState(false)
  const enter = useCallback((c: string) => setCode(c), [])
  const exit = useCallback(() => {
    setCode(null)
    setToolsRevealed(false)
  }, [])
  const value = useMemo<TourModeValue>(
    () => ({ active: code !== null, code, enter, exit, toolsRevealed, setToolsRevealed }),
    [code, enter, exit, toolsRevealed]
  )
  return <TourModeContext.Provider value={value}>{children}</TourModeContext.Provider>
}

export function useTourMode() {
  return useContext(TourModeContext)
}
