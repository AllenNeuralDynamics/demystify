export interface CollaboratorProfile {
  id: string
  name: string
  color: string
  colorLight: string
}

const profileKey = 'demystify.profile'
const colors = [
  { color: '#16705d', colorLight: '#dcefe8' },
  { color: '#c14f3d', colorLight: '#f7e3df' },
  { color: '#315f9b', colorLight: '#e0e9f5' },
  { color: '#9a6b16', colorLight: '#f6ebd2' },
  { color: '#7d4b8f', colorLight: '#eee2f2' },
]

const createProfile = (): CollaboratorProfile => {
  const color = colors[Math.floor(Math.random() * colors.length)] ?? colors[0]
  return {
    id: crypto.randomUUID(),
    name: `Researcher ${Math.floor(Math.random() * 90) + 10}`,
    ...color,
  }
}

export const loadProfile = (): CollaboratorProfile => {
  try {
    const storedProfile = localStorage.getItem(profileKey)
    if (storedProfile) return JSON.parse(storedProfile) as CollaboratorProfile
  } catch {
    // A private browsing policy can make localStorage unavailable.
  }

  const profile = createProfile()
  saveProfile(profile)
  return profile
}

export const saveProfile = (profile: CollaboratorProfile) => {
  try {
    localStorage.setItem(profileKey, JSON.stringify(profile))
  } catch {
    // The in-memory profile still works for this session.
  }
}