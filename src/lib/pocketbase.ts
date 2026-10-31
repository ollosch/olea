import PocketBase from 'pocketbase'

// Vite proxies /api during development; the built app uses the same origin.
export const pb = new PocketBase(window.location.origin)
