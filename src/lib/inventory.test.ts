import { inventoryRows } from './inventory.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Item = { id: string; name: string; container: string; notes?: string }
const items: Item[] = [
  { id: 'backpack', name: 'Backpack', container: '' },
  { id: 'pouch', name: 'Pouch', container: 'backpack' },
  { id: 'ration', name: 'Ration', container: 'pouch', notes: 'Salted' },
  { id: 'arrows', name: 'Arrows', container: '' },
  { id: 'relic', name: 'Relic', container: 'missing container' },
]

const all = inventoryRows(items)
assert(all.rows.map((row) => row.item.id).join(',') === 'arrows,backpack,pouch,ration,relic', 'name-sorted hierarchy rows should include roots and nested items')
assert(all.matched === 5 && all.total === 5, 'an empty query matches every item')
const ration = all.rows.find((row) => row.item.id === 'ration')!
assert(ration.depth === 2, 'nested depth should count containers')
assert(ration.location.join(' > ') === 'Backpack > Pouch', 'location should name the containers from outermost to parent')
assert(all.rows.find((row) => row.item.id === 'relic')!.depth === 0, 'a missing parent should be shown as a root')

const collapsed = inventoryRows(items, { collapsed: new Set(['backpack']) })
assert(collapsed.rows.map((row) => row.item.id).join(',') === 'arrows,backpack,relic', 'collapsing a container should hide its descendants')
assert(collapsed.rows.find((row) => row.item.id === 'backpack')!.expanded === false, 'collapsed containers report their state')
assert(collapsed.rows.find((row) => row.item.id === 'backpack')!.childCount === 1, 'child count includes hidden descendants')

const rations = inventoryRows(items, { query: 'ration' })
assert(rations.rows.map((row) => row.item.id).join(',') === 'backpack,pouch,ration', 'search should reveal matches and their ancestors')
assert(rations.matched === 1, 'search counts only matching items')
assert(inventoryRows(items, { query: 'pouch' }).rows.map((row) => row.item.id).join(',') === 'backpack,pouch,ration', 'search also matches container locations')
assert(inventoryRows(items, { query: 'salted', text: (item, location) => [item.name, item.notes ?? '', ...location].join(' ') }).matched === 1, 'custom search text can include notes')
assert(inventoryRows(items, { query: 'nothing here' }).rows.length === 0, 'an unmatched search shows no rows')

const collapsedSearch = inventoryRows(items, { query: 'ration', collapsed: new Set(['backpack', 'pouch']) })
assert(collapsedSearch.rows.length === 3, 'search expands collapsed ancestors')

const cyclic: Item[] = [
  { id: 'a', name: 'A', container: 'b' },
  { id: 'b', name: 'B', container: 'a' },
  { id: 'c', name: 'C', container: 'c' },
]
const cycleRows = inventoryRows(cyclic)
assert(cycleRows.rows.length === 3, 'cycles should still be listed once')
assert(new Set(cycleRows.rows.map((row) => row.item.id)).size === 3, 'cycle traversal should not duplicate items')

console.log('inventory hierarchy checks passed')
