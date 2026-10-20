'use client'

// This browser's private guest secret: random, made on first use, kept in
// local storage so the same person is the same guest across reloads. If
// storage is blocked (some embedded webviews) it lives in memory for the visit.
const KEY = 'gavel-guest-secret'
let memory: string | null = null

function random() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function guestSecret(): string {
  if (memory) return memory
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) {
      memory = stored
      return stored
    }
    memory = random()
    window.localStorage.setItem(KEY, memory)
  } catch {
    memory ??= random()
  }
  return memory
}
