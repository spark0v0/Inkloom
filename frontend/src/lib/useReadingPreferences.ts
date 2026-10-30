import { useEffect, useState } from 'react'

type ReadingPreferences = { fontSize: number; fontFamily: 'sans' | 'serif' }
const key = 'inkloom.reading-preferences.v1'
const defaults: ReadingPreferences = { fontSize: 18, fontFamily: 'sans' }
const sizes = [16, 18, 20, 22]

function readPreferences(): ReadingPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!saved || typeof saved !== 'object') return defaults
    const values = saved as Partial<ReadingPreferences>
    return {
      fontSize: typeof values.fontSize === 'number' && sizes.includes(values.fontSize) ? values.fontSize : defaults.fontSize,
      fontFamily: values.fontFamily === 'serif' ? 'serif' : 'sans',
    }
  } catch { return defaults }
}

// Presentation preferences only; they never change the manuscript or its history.
export function useReadingPreferences() {
  const [preferences, setPreferences] = useState(readPreferences)
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* Reading still works when storage is unavailable. */ }
  }, [preferences])
  return {
    ...preferences,
    setFontSize: (fontSize: number) => setPreferences(current => ({ ...current, fontSize })),
    setFontFamily: (fontFamily: ReadingPreferences['fontFamily']) => setPreferences(current => ({ ...current, fontFamily })),
  }
}
