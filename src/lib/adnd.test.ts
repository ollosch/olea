import { adndHitDice, wikiText } from './adnd.ts'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const source = { format: 'adnd2e-html', stats: { 'Hit Dice': '4+2' } }
assert(adndHitDice(source) === '4d8+2', 'simple hit dice should roll d8s with modifier')
for (const value of ['1/2', '4-6', '4+2 or 5', '4d10', 'special', '']) {
  assert(adndHitDice({ format: 'adnd2e-html', stats: { 'Hit Dice': value } }) === null, `ambiguous dice must remain manual: ${value}`)
}
const rendered = wikiText(`==Title==\n[[Target|Displayed]] {{frac|1|2}} {{unusual|value}}\n[[Category:Spells]]`)
assert(rendered.includes('Displayed 1/2 [unusual: value]') && !rendered.includes('Category:'), 'wiki content should remain readable')
