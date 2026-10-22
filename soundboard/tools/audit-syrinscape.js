#!/usr/bin/env node
// Read-only audit of the Syrinscape XML tree and the current config.json data.
//
// Usage:
//   node soundboard/tools/audit-syrinscape.js [--json [path]]
//
// AUDIO_DIR resolution:
//   OLEA_AUDIO_DIR is used when set (relative paths resolve against soundboard/),
//   otherwise <soundboard>/syrinscape is used.
//
// This script only reads .xml and config.json files. It never opens audio files.
// It does not modify configs.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseXml } from '../xml.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOUNDBOARD_DIR = path.resolve(__dirname, '..')

const XML_RE = /\.xml$/i
const GENERATED_XML_RE = /\.generated\.xml$/i
const AUDIO_RE = /\.(ogg|mp3|wav)$/i

const SECTION_NAMES = ['MusicElements', 'SfxElements', 'LoopElements', 'OneshotElements']

const WATCHED_FIELDS = [
  'Title',
  'Slug',
  'InitialGain',
  'InitialIntensity',
  'RandomisePlaylist',
  'MinTriggerWait',
  'MaxTriggerWait',
  'MinStartDelay',
  'MaxStartDelay',
  'ReverbPreset',
  'BypassPosition',
  'MinAngle',
  'MaxAngle',
  'MinDistance',
  'MaxDistance',
  'IsGlobalOneshot',
  'RepeatPlaylist',
  'AllowPlaylistOverlap',
  'BypassEffects',
  'ReverseDirection',
  'Speed',
]

const PLAYLIST_ENTRY_FIELDS = [
  'SampleFile',
  'MinGain',
  'MaxGain',
  'Position',
  'MinElementIntensity',
  'MaxElementIntensity',
]

const ELEMENT_PARAMETER_FIELDS = ['ElementSlug', 'Plays', 'Intensity', 'Volume']

// --- small helpers -----------------------------------------------------------

function usage() {
  console.log(`Usage: node soundboard/tools/audit-syrinscape.js [--json [path]]

  --json [path]   also write the full report as JSON
                  (default: ${path.join(SOUNDBOARD_DIR, 'SYRINSCAPE_AUDIT.json')})
  -h, --help      show this help`)
}

function parseArgs(argv) {
  const opts = { jsonPath: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      opts.help = true
    } else if (arg === '--json') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        opts.jsonPath = next
        i++
      } else {
        opts.jsonPath = path.join(SOUNDBOARD_DIR, 'SYRINSCAPE_AUDIT.json')
      }
    } else if (arg.startsWith('--json=')) {
      opts.jsonPath = arg.slice('--json='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return opts
}

function resolveAudioDir() {
  const raw = process.env.OLEA_AUDIO_DIR
  if (!raw) return path.join(SOUNDBOARD_DIR, 'syrinscape')
  return path.isAbsolute(raw) ? raw : path.resolve(SOUNDBOARD_DIR, raw)
}

function bump(map, key, by = 1) {
  map[key] = (map[key] || 0) + by
}

function child(node, name) {
  return node?.children.find((c) => c.name === name) || null
}

function textOf(node) {
  return node ? node.text.trim() : ''
}

function numOf(node) {
  const t = textOf(node)
  if (!t) return null
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function sortedObject(map) {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
}

function sortedByCount(map) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function pct(hit, total) {
  if (!total) return 'n/a'
  return `${((hit / total) * 100).toFixed(0)}%`
}

function pad(s, width) {
  s = String(s)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function lpad(s, width) {
  s = String(s)
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function countNodePaths(node, parent, out) {
  const p = parent ? `${parent}/${node.name}` : node.name
  bump(out, p)
  for (const c of node.children) countNodePaths(c, p, out)
}

// --- filesystem walk ---------------------------------------------------------

function firstSegment(audioDir, file) {
  const rel = path.relative(audioDir, file)
  if (!rel || rel.startsWith('..')) return null
  return rel.split(path.sep)[0]
}

// --- XML audit ---------------------------------------------------------------

function auditXml(xmlFiles) {
  const stats = {
    files: xmlFiles.length,
    parsed: 0,
    failed: [],
    roots: {},
    formatVersions: {},
    chapterFields: {},
    sections: {},
    sectionElements: {},
    elementTypes: {},
    elementTotals: {},
    elementFields: {},
    playlist: { elementsWithPlaylist: 0, entries: 0, entryFields: {}, emptyPlaylists: 0 },
    samples: { count: 0, fields: {} },
    moods: { files: 0, count: 0, fields: {}, elementParameters: 0, elementParameterFields: {} },
    values: {
      randomise: {},
      reverb: {},
      bypassPosition: {},
      maxTriggerWait: { positive: 0, zero: 0, negative: 0, missing: 0 },
      maxStartDelay: { positive: 0, zero: 0, missing: 0 },
      initialGain: { one: 0, other: 0, missing: 0 },
    },
    nodePaths: {},
  }

  for (const name of SECTION_NAMES) {
    stats.sections[name] = { files: 0, elements: 0 }
  }

  for (const file of xmlFiles) {
    let root
    try {
      root = parseXml(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      stats.failed.push({ file, error: err.message })
      continue
    }
    if (!root) {
      stats.failed.push({ file, error: 'empty XML' })
      continue
    }
    stats.parsed++
    bump(stats.roots, root.name)
    countNodePaths(root, '', stats.nodePaths)

    for (const c of root.children) bump(stats.chapterFields, c.name)

    const format = child(root, 'FormatVersion')
    if (format) bump(stats.formatVersions, textOf(format) || '(empty)')

    const samplesNode = child(root, 'Samples')
    if (samplesNode) {
      for (const sample of samplesNode.children) {
        if (sample.name !== 'SoundSample') continue
        stats.samples.count++
        for (const f of sample.children) bump(stats.samples.fields, f.name)
      }
    }

    const seenSections = new Set()
    for (const section of root.children) {
      if (!/Elements$/i.test(section.name)) continue
      if (!stats.sections[section.name]) {
        stats.sections[section.name] = { files: 0, elements: 0 }
      }
      if (!seenSections.has(section.name)) {
        stats.sections[section.name].files++
        seenSections.add(section.name)
      }

      for (const el of section.children) {
        stats.sections[section.name].elements++
        bump(stats.elementTypes, el.name)
        bump(stats.elementTotals, el.name)
        bump(stats.sectionElements, `${section.name}/${el.name}`)

        if (!stats.elementFields[el.name]) stats.elementFields[el.name] = {}

        for (const f of el.children) {
          bump(stats.elementFields[el.name], f.name)

          if (f.name === 'Playlist') {
            stats.playlist.elementsWithPlaylist++
            let entries = 0
            for (const pe of f.children) {
              if (pe.name !== 'PlaylistEntry') continue
              entries++
              stats.playlist.entries++
              for (const pf of pe.children) bump(stats.playlist.entryFields, pf.name)
            }
            if (entries === 0) stats.playlist.emptyPlaylists++
          }
        }
        const randomise = textOf(child(el, 'RandomisePlaylist'))
        bump(stats.values.randomise, randomise || '(empty)')

        const reverb = textOf(child(el, 'ReverbPreset'))
        bump(stats.values.reverb, reverb || '(empty)')

        const bypass = textOf(child(el, 'BypassPosition'))
        bump(stats.values.bypassPosition, bypass || '(empty)')

        const maxTW = numOf(child(el, 'MaxTriggerWait'))
        if (maxTW === null) stats.values.maxTriggerWait.missing++
        else if (maxTW > 0) stats.values.maxTriggerWait.positive++
        else if (maxTW === 0) stats.values.maxTriggerWait.zero++
        else stats.values.maxTriggerWait.negative++

        const maxStart = numOf(child(el, 'MaxStartDelay'))
        if (maxStart === null) stats.values.maxStartDelay.missing++
        else if (maxStart > 0) stats.values.maxStartDelay.positive++
        else stats.values.maxStartDelay.zero++

        const gain = numOf(child(el, 'InitialGain'))
        if (gain === null) stats.values.initialGain.missing++
        else if (Math.abs(gain - 1) < 1e-9) stats.values.initialGain.one++
        else stats.values.initialGain.other++
      }
    }

    const moodsNode = child(root, 'Moods')
    if (moodsNode) {
      stats.moods.files++
      for (const mood of moodsNode.children) {
        if (mood.name !== 'Mood') continue
        stats.moods.count++
        for (const f of mood.children) {
          bump(stats.moods.fields, f.name)
          if (f.name !== 'ElementParameters') continue
          for (const ep of f.children) {
            if (ep.name !== 'ElementParameter') continue
            stats.moods.elementParameters++
            for (const pf of ep.children) bump(stats.moods.elementParameterFields, pf.name)
          }
        }
      }
    }
  }

  stats.roots = sortedByCount(stats.roots)
  stats.formatVersions = sortedByCount(stats.formatVersions)
  stats.chapterFields = sortedByCount(stats.chapterFields)
  stats.elementTypes = sortedByCount(stats.elementTypes)
  stats.elementTotals = sortedByCount(stats.elementTotals)
  stats.sectionElements = sortedByCount(stats.sectionElements)
  for (const type of Object.keys(stats.elementFields)) {
    stats.elementFields[type] = sortedByCount(stats.elementFields[type])
  }
  stats.elementFields = sortedObject(stats.elementFields)
  stats.playlist.entryFields = sortedByCount(stats.playlist.entryFields)
  stats.samples.fields = sortedByCount(stats.samples.fields)
  stats.moods.fields = sortedByCount(stats.moods.fields)
  stats.moods.elementParameterFields = sortedByCount(stats.moods.elementParameterFields)
  stats.values.randomise = sortedByCount(stats.values.randomise)
  stats.values.reverb = sortedByCount(stats.values.reverb)
  stats.values.bypassPosition = sortedByCount(stats.values.bypassPosition)
  stats.nodePaths = sortedByCount(stats.nodePaths)

  return stats
}

// --- config audit ------------------------------------------------------------

function auditConfigs(configFiles, packStatus) {
  const stats = {
    total: 0,
    parseFailures: [],
    disabled: 0,
    allOneshot: 0,
    zeroLoopsAndRandoms: 0,
    empty: 0,
    kinds: { loop: 0, random: 0, oneshot: 0, unknown: 0 },
    crossTab: {},
    allOneshotExamples: [],
    zeroLoopsAndRandomsExamples: [],
    disabledExamples: [],
  }

  const ensureCross = (status) => {
    if (!stats.crossTab[status]) {
      stats.crossTab[status] = {
        configs: 0,
        disabled: 0,
        allOneshot: 0,
        zeroLoopsAndRandoms: 0,
        kinds: { loop: 0, random: 0, oneshot: 0, unknown: 0 },
      }
    }
    return stats.crossTab[status]
  }

  for (const file of configFiles) {
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      stats.parseFailures.push({ file, error: err.message })
      continue
    }

    stats.total++
    const status = packStatus(file)
    const ct = ensureCross(status)
    ct.configs++

    const elements = Array.isArray(cfg.elements) ? cfg.elements : []
    const kinds = { loop: 0, random: 0, oneshot: 0, unknown: 0 }
    for (const el of elements) {
      const kind = el && typeof el.kind === 'string' ? el.kind : 'unknown'
      if (kind === 'loop' || kind === 'random' || kind === 'oneshot') kinds[kind]++
      else kinds.unknown++
    }

    for (const kind of Object.keys(kinds)) {
      stats.kinds[kind] += kinds[kind]
      ct.kinds[kind] += kinds[kind]
    }

    const allOneshot = elements.length > 0 && kinds.loop === 0 && kinds.random === 0 && kinds.oneshot > 0
    const zeroLR = kinds.loop === 0 && kinds.random === 0
    const disabled = Boolean(cfg.disabled)

    if (allOneshot) {
      stats.allOneshot++
      ct.allOneshot++
      if (stats.allOneshotExamples.length < 12) {
        stats.allOneshotExamples.push({ file, name: cfg.name || null, elements: elements.length })
      }
    }
    if (zeroLR) {
      stats.zeroLoopsAndRandoms++
      ct.zeroLoopsAndRandoms++
      if (stats.zeroLoopsAndRandomsExamples.length < 12) {
        stats.zeroLoopsAndRandomsExamples.push({ file, name: cfg.name || null, elements: elements.length })
      }
    }
    if (elements.length === 0) stats.empty++
    if (disabled) {
      stats.disabled++
      ct.disabled++
      if (stats.disabledExamples.length < 12) {
        stats.disabledExamples.push({ file, name: cfg.name || null })
      }
    }
  }

  stats.crossTab = Object.fromEntries(
    Object.entries(stats.crossTab).sort(([a], [b]) => a.localeCompare(b))
  )

  return stats
}

// --- pack audit --------------------------------------------------------------

function auditPacks(audioDir, xmlFiles, generatedFiles, configFiles, audioCounts) {
  const packNames = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))

  const packs = packNames.map((name) => ({
    name,
    status: 'no-xml',
    realXml: [],
    generatedXml: [],
    configs: [],
    audioFiles: audioCounts.get(name) || 0,
    kinds: { loop: 0, random: 0, oneshot: 0, unknown: 0 },
    disabled: 0,
    allOneshot: 0,
    zeroLoopsAndRandoms: 0,
  }))
  const byName = new Map(packs.map((p) => [p.name, p]))

  for (const file of xmlFiles) {
    const p = byName.get(firstSegment(audioDir, file))
    if (p) p.realXml.push(file)
  }
  for (const file of generatedFiles) {
    const p = byName.get(firstSegment(audioDir, file))
    if (p) p.generatedXml.push(file)
  }
  for (const file of configFiles) {
    const p = byName.get(firstSegment(audioDir, file))
    if (p) p.configs.push(file)
  }

  // Attach config classification stats to their pack.
  for (const file of configFiles) {
    const p = byName.get(firstSegment(audioDir, file))
    if (!p) continue
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const elements = Array.isArray(cfg.elements) ? cfg.elements : []
    const kinds = { loop: 0, random: 0, oneshot: 0, unknown: 0 }
    for (const el of elements) {
      const kind = el && typeof el.kind === 'string' ? el.kind : 'unknown'
      if (kind in kinds) kinds[kind]++
      else kinds.unknown++
    }
    for (const kind of Object.keys(kinds)) p.kinds[kind] += kinds[kind]
    if (cfg.disabled) p.disabled++
    if (elements.length > 0 && kinds.loop === 0 && kinds.random === 0 && kinds.oneshot > 0) p.allOneshot++
    if (kinds.loop === 0 && kinds.random === 0) p.zeroLoopsAndRandoms++
  }

  for (const p of packs) {
    p.status = p.realXml.length ? 'real-xml' : p.generatedXml.length ? 'generated-only' : 'no-xml'
  }

  const summary = {
    total: packs.length,
    realXml: packs.filter((p) => p.status === 'real-xml').length,
    generatedOnly: packs.filter((p) => p.status === 'generated-only').length,
    noXml: packs.filter((p) => p.status === 'no-xml').length,
    realXmlFiles: xmlFiles.length,
    generatedXmlFiles: generatedFiles.length,
    configs: configFiles.length,
  }

  const noXmlPacks = packs
    .filter((p) => p.status === 'no-xml')
    .map((p) => ({ name: p.name, audioFiles: p.audioFiles, configs: p.configs.length, empty: p.audioFiles === 0 && p.configs.length === 0 }))

  const packStatus = (file) => {
    const p = byName.get(firstSegment(audioDir, file))
    return p ? p.status : '(root)'
  }

  return { packs, summary, noXmlPacks, packStatus }
}

// --- report printing ---------------------------------------------------------

function printReport(report) {
  const { audioDir, packs, xml, configs } = report
  const s = packs.summary

  console.log('Syrinscape audit')
  console.log(`Audio dir: ${audioDir}`)
  console.log(`Mode: read-only (only .xml and config.json contents were read)`)
  console.log('')

  console.log('PACKS (top-level folders)')
  console.log(`  total:                 ${s.total}`)
  console.log(`  with real XML:         ${s.realXml} packs (${s.realXmlFiles} XML files)`)
  console.log(`  only .generated.xml:   ${s.generatedOnly} packs (${s.generatedXmlFiles} XML files)`)
  console.log(`  no XML:                ${s.noXml} packs`)
  const empty = packs.noXmlPacks.filter((p) => p.empty).length
  console.log(`    of which empty:      ${empty} packs (no audio, no config)`)
  console.log(`  config.json files:     ${s.configs}`)
  console.log('')

  console.log('XML STRUCTURE')
  console.log(`  parsed:                ${xml.parsed}/${xml.files} ok, ${xml.failed.length} failed`)
  const roots = Object.entries(xml.roots).map(([k, v]) => `${k} (${v})`).join(', ')
  console.log(`  root elements:         ${roots || 'none'}`)
  const formats = Object.entries(xml.formatVersions).map(([k, v]) => `${k} (${v})`).join(', ')
  console.log(`  FormatVersion:         ${formats || 'none'}`)
  console.log('  chapter sections:')
  for (const name of SECTION_NAMES) {
    const sec = xml.sections[name]
    if (!sec) continue
    const types = Object.entries(xml.sectionElements)
      .filter(([k]) => k.startsWith(`${name}/`))
      .map(([k, v]) => `${k.slice(name.length + 1)}: ${v}`)
      .join(', ')
    console.log(`    ${pad(name, 18)} ${lpad(sec.files, 4)} files, ${lpad(sec.elements, 6)} elements${types ? ` (${types})` : ''}`)
  }
  console.log('  element node types:')
  for (const [type, count] of Object.entries(xml.elementTypes)) {
    console.log(`    ${pad(type, 18)} ${lpad(count, 6)}`)
  }
  console.log('')

  console.log('ELEMENT FIELD AVAILABILITY (fields present on at least one element)')
  const types = Object.keys(xml.elementTotals)
  const watched = new Set(WATCHED_FIELDS)
  for (const type of types) {
    for (const field of Object.keys(xml.elementFields[type] || {})) watched.add(field)
  }
  const fieldRows = [...watched].sort((a, b) => a.localeCompare(b))
  const labelWidth = 26
  const colWidth = 22
  console.log(`  ${pad('field', labelWidth)}${types.map((t) => pad(`${t} (${xml.elementTotals[t]})`, colWidth)).join('')}`)
  for (const field of fieldRows) {
    const cells = types.map((t) => {
      const n = xml.elementFields[t]?.[field] || 0
      return pad(n ? `${n} (${pct(n, xml.elementTotals[t])})` : '-', colWidth)
    })
    console.log(`  ${pad(field, labelWidth)}${cells.join('')}`)
  }
  console.log('')

  console.log('PLAYLIST / SAMPLES / MOODS')
  console.log(`  Playlist nodes:        ${xml.playlist.elementsWithPlaylist}`)
  console.log(`  PlaylistEntry nodes:   ${xml.playlist.entries} (empty Playlists: ${xml.playlist.emptyPlaylists})`)
  console.log(`  PlaylistEntry fields:  ${Object.entries(xml.playlist.entryFields).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`)
  console.log(`  SoundSample nodes:     ${xml.samples.count}`)
  console.log(`  SoundSample fields:    ${Object.entries(xml.samples.fields).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`)
  console.log(`  Moods:                 ${xml.moods.files} files, ${xml.moods.count} moods`)
  console.log(`  Mood fields:           ${Object.entries(xml.moods.fields).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`)
  console.log(`  ElementParameter:      ${xml.moods.elementParameters} nodes; fields: ${Object.entries(xml.moods.elementParameterFields).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`)
  console.log('')

  console.log('SELECTED VALUE DISTRIBUTIONS')
  console.log(`  RandomisePlaylist:     ${Object.entries(xml.values.randomise).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
  console.log(`  ReverbPreset:          ${Object.keys(xml.values.reverb).length} distinct values; ${Object.entries(xml.values.reverb).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
  console.log(`  BypassPosition:        ${Object.entries(xml.values.bypassPosition).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
  const tw = xml.values.maxTriggerWait
  console.log(`  MaxTriggerWait:        positive: ${tw.positive}, zero: ${tw.zero}, negative: ${tw.negative}, missing: ${tw.missing}`)
  const sd = xml.values.maxStartDelay
  console.log(`  MaxStartDelay:         positive: ${sd.positive}, zero: ${sd.zero}, missing: ${sd.missing}`)
  const ig = xml.values.initialGain
  console.log(`  InitialGain:           ==1: ${ig.one}, other: ${ig.other}, missing: ${ig.missing}`)
  console.log('')

  const nodeKeys = Object.keys(xml.nodePaths)
  console.log('NODE PATHS (sample)')
  const wanted = [
    'Chapter/Title',
    'Chapter/InitialGain',
    'Chapter/MusicElements/MusicElement/Title',
    'Chapter/MusicElements/MusicElement/Slug',
    'Chapter/SfxElements/SFXElement/Title',
    'Chapter/SfxElements/SFXElement/MinTriggerWait',
    'Chapter/SfxElements/SFXElement/Playlist/PlaylistEntry/SampleFile',
    'Chapter/MusicElements/MusicElement/Playlist/PlaylistEntry/SampleFile',
    'Chapter/OneshotElements/OneshotElement/Playlist/PlaylistEntry/SampleFile',
    'Chapter/Moods/Mood/ElementParameters/ElementParameter/ElementSlug',
  ]
  for (const key of wanted) {
    if (xml.nodePaths[key] !== undefined) console.log(`  ${pad(key, 76)} ${xml.nodePaths[key]}`)
  }
  console.log(`  (${nodeKeys.length} distinct node paths collected; full list in JSON report)`)
  console.log('')

  console.log('EXISTING CONFIG.JSON CLASSIFICATION')
  console.log(`  soundsets:             ${configs.total}`)
  console.log(`  elements:              ${configs.kinds.loop + configs.kinds.random + configs.kinds.oneshot + configs.kinds.unknown}`)
  console.log(`    loop:                ${configs.kinds.loop}`)
  console.log(`    random:              ${configs.kinds.random}`)
  console.log(`    oneshot:             ${configs.kinds.oneshot}`)
  if (configs.kinds.unknown) console.log(`    unknown:             ${configs.kinds.unknown}`)
  console.log(`  disabled soundsets:    ${configs.disabled}`)
  console.log(`  all-oneshot soundsets: ${configs.allOneshot}`)
  console.log(`  zero loops + randoms:  ${configs.zeroLoopsAndRandoms}`)
  console.log(`  empty soundsets:       ${configs.empty}`)
  console.log('  by source:')
  for (const [status, ct] of Object.entries(configs.crossTab)) {
    console.log(`    ${pad(status, 16)} ${lpad(ct.configs, 4)} configs, loop ${ct.kinds.loop}, random ${ct.kinds.random}, oneshot ${ct.kinds.oneshot}, all-oneshot ${ct.allOneshot}, disabled ${ct.disabled}`)
  }
  if (configs.allOneshotExamples.length) {
    console.log('  all-oneshot examples:')
    for (const ex of configs.allOneshotExamples) {
      console.log(`    ${ex.name || '(unnamed)'} — ${ex.elements} elements — ${path.relative(audioDir, ex.file)}`)
    }
  }
  console.log('')

  console.log('NOTABLE PACKS')
  const notable = packs.items.filter((p) => /carrion|dragon.?heist/i.test(p.name))
  if (!notable.length) {
    console.log('  none matched carrion / dragon heist')
  } else {
    for (const p of notable) {
      console.log(`  ${p.name}`)
      console.log(`    status: ${p.status}, real XML: ${p.realXml}, generated XML: ${p.generatedXml}, configs: ${p.configs}`)
      console.log(`    elements: loop ${p.kinds.loop}, random ${p.kinds.random}, oneshot ${p.kinds.oneshot}; all-oneshot configs: ${p.allOneshot}`)
    }
  }
  console.log('')

  if (xml.failed.length) {
    console.log('XML PARSE FAILURES')
    for (const f of xml.failed) console.log(`  ${f.file}: ${f.error}`)
    console.log('')
  }
  if (configs.parseFailures.length) {
    console.log('CONFIG PARSE FAILURES')
    for (const f of configs.parseFailures) console.log(`  ${f.file}: ${f.error}`)
    console.log('')
  }
}

// --- main --------------------------------------------------------------------

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    usage()
    process.exitCode = 2
    return
  }
  if (opts.help) {
    usage()
    return
  }

  const audioDir = resolveAudioDir()
  let stat
  try {
    stat = fs.statSync(audioDir)
  } catch {
    console.error(`Audio directory not found: ${audioDir}`)
    process.exitCode = 1
    return
  }
  if (!stat.isDirectory()) {
    console.error(`Audio path is not a directory: ${audioDir}`)
    process.exitCode = 1
    return
  }

  const visit = { xml: [], generated: [], configs: [], errors: [] }
  const topDirs = fs
    .readdirSync(audioDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  const audioCounts = new Map(topDirs.map((n) => [n, 0]))

  // Walk once, counting audio per top-level pack without opening audio files.
  function walk(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      visit.errors.push(`${dir}: ${err.message}`)
      return
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
      } else if (entry.isFile()) {
        if (GENERATED_XML_RE.test(entry.name)) visit.generated.push(p)
        else if (XML_RE.test(entry.name)) visit.xml.push(p)
        else if (entry.name === 'config.json') visit.configs.push(p)
        else if (AUDIO_RE.test(entry.name)) {
          const top = firstSegment(audioDir, p)
          if (top && audioCounts.has(top)) audioCounts.set(top, audioCounts.get(top) + 1)
        }
      }
    }
  }
  walk(audioDir)

  const xml = auditXml(visit.xml)
  const packAudit = auditPacks(audioDir, visit.xml, visit.generated, visit.configs, audioCounts)
  const configs = auditConfigs(visit.configs, packAudit.packStatus)

  const report = {
    generatedAt: new Date().toISOString(),
    audioDir,
    packs: {
      summary: packAudit.summary,
      noXmlPacks: packAudit.noXmlPacks,
      items: packAudit.packs.map((p) => ({
        name: p.name,
        status: p.status,
        realXml: p.realXml.length,
        generatedXml: p.generatedXml.length,
        configs: p.configs.length,
        audioFiles: p.audioFiles,
        kinds: p.kinds,
        allOneshot: p.allOneshot,
        zeroLoopsAndRandoms: p.zeroLoopsAndRandoms,
        disabled: p.disabled,
      })),
    },
    xml,
    configs,
    errors: visit.errors,
  }

  printReport(report)

  if (opts.jsonPath) {
    const outPath = path.isAbsolute(opts.jsonPath)
      ? opts.jsonPath
      : path.resolve(SOUNDBOARD_DIR, opts.jsonPath)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
    console.log(`JSON report written to ${outPath}`)
  }
}

main()
