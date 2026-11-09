/**
 * Generate an invented, disposable catalog for performance measurements.
 * Never point this at real source material or a real data directory.
 *
 * Usage: bun scripts/perf-catalog.ts <output.json> [record-count]
 */
const output = process.argv[2]
const count = Number(process.argv[3] ?? process.env.E2E_CATALOG_PERF_COUNT ?? 2000)

if (!output || !Number.isInteger(count) || count < 1) {
  throw new Error('Usage: bun scripts/perf-catalog.ts <output.json> [positive-record-count]')
}

const paragraph = 'An invented reference paragraph for performance measurement with ordinary table wording, durations, ranges, components and consequences. '.repeat(8)
const schools = ['Evocation', 'Illusion', 'Abjuration', 'Divination', 'Enchantment']
const records = []

for (let index = 1; index <= count; index++) {
  const number = String(index).padStart(4, '0')
  records.push({
    type: 'spell',
    source: index % 7 === 0 ? 'XGE' : 'PHB',
    source_id: `perf-spell-${number}`,
    name: `Perf Spell ${number}`,
    level: String(index % 10),
    school: schools[index % schools.length],
    original: {
      page: 100 + (index % 250),
      format: 'invented',
      entries: [
        paragraph,
        `Measured invented spell ${number}.`,
        { type: 'list', items: Array.from({ length: 12 }, (_, item) => `Invented bullet ${item} for ${number}.`) },
      ],
      entriesHigherLevel: [paragraph],
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { amount: 30 + (index % 90), type: 'feet' } },
      duration: [{ type: 'timed', duration: { amount: 1, type: 'minute' } }],
      components: { v: true, s: true, m: 'an invented token' },
      misc: { key: `value-${index}`, list: Array.from({ length: 20 }, (_, item) => `tag-${item}`) },
    },
  })
}

await Bun.write(output, JSON.stringify({ records }))
console.log(`Wrote ${count} invented catalog records to ${output}`)
