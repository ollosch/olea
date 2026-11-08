import type { LocationQuery } from 'vue-router'
import type { CatalogFilter } from './systems'

export const catalogTypes = ['spell', 'creature', 'item'] as const
export type CatalogListType = (typeof catalogTypes)[number]

export function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export function isCatalogType(value: string): value is CatalogListType {
  return (catalogTypes as readonly string[]).includes(value)
}

export function normalizedCatalogType(value: unknown): CatalogListType {
  const candidate = queryString(value)
  return isCatalogType(candidate) ? candidate : 'spell'
}

/** Page numbers are one-based; malformed values are sanitized later in the route. */
export function catalogPage(value: unknown): { page: number; valid: boolean } {
  if (value === undefined) return { page: 1, valid: true }
  const text = queryString(value)
  const page = Number(text)
  return text && Number.isInteger(page) && page >= 1 ? { page, valid: true } : { page: 1, valid: false }
}

export function readCatalogFilters(query: LocationQuery, filters: readonly CatalogFilter[]) {
  const values: Record<string, string> = {}
  let explicit = false
  for (const filter of filters) {
    const value = query[filter.key]
    if (typeof value === 'string') {
      values[filter.key] = value
      explicit = true
    }
  }
  return { values, explicit }
}
