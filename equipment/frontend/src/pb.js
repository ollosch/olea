import PocketBase from 'pocketbase'

// Base URL "/" works both in dev (Vite proxies /api to PocketBase) and in
// production (PocketBase serves the built app from pb_public).
export const pb = new PocketBase('/')
