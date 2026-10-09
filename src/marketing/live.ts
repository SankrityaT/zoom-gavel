'use client'

import { useSyncExternalStore } from 'react'

// The hero's running round, shared with the navigation so the bar can carry
// the price and the clock down the page.
export type LiveLot = {
  itemName: string
  price: number
  /** Wall-clock ms the round ends at. */
  endsAt: number
  open: boolean
  sold: boolean
}

let current: LiveLot | null = null
const listeners = new Set<() => void>()

export function publishLive(next: LiveLot | null) {
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLive() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}
