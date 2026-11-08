import type { CatalogRecord } from './catalog'

export type Game = {
  id: string
  updated: string
  name: string
  system: string
  encounter_visible: boolean
  encounter_show_initiative: boolean
  encounter_show_enemy_names: boolean
  encounter_show_hp: boolean
  encounter_show_conditions: boolean
  expand?: { system?: { key: string; name: string } }
}

export type Encounter = { id: string; game: string; name: string }

export type Entry = {
  id: string
  encounter: string
  creature: string
  name: string
  quantity: number
  notes: string
  custom: boolean
  expand?: { creature?: CatalogRecord }
}

export type Character = { id: string; name: string; game: string }

export type Combat = {
  id: string
  updated: string
  encounter: string
  active: boolean
  round: number
  turn: number
  active_participant: string
  tie_order: string
  name: string
  visible: boolean
  show_initiative: boolean
  show_enemy_names: boolean
  show_hp: boolean
  show_conditions: boolean
}

export type Combatant = {
  id: string
  updated: string
  combat: string
  character: string
  prepared: string
  name: string
  enemy: boolean
  current_hp: number
  max_hp: number
  hp_known: boolean
  initiative: number
  initiative_known: boolean
  initiative_modifier: number
  initiative_modifier_override: boolean
  dexterity_modifier: number
  dexterity_known: boolean
  hp_formula: string
  conditions: string
  notes: string
  sort_order: number
  expand?: { character?: Character; prepared?: Entry }
}

export type EntryDraft = { quantity: number; notes: string }

export type CombatDraft = {
  initiative: number | ''
  current_hp: number | ''
  max_hp: number | ''
  conditions: string
  notes: string
}

export type HPPreview = { current: number; max: number }

export type PickerFeedback = { tone: 'status' | 'error'; message: string }

export type DisplaySettingField =
  | 'encounter_visible'
  | 'encounter_show_initiative'
  | 'encounter_show_enemy_names'
  | 'encounter_show_hp'
  | 'encounter_show_conditions'

export type HPMode = 'average' | 'roll' | 'manual'
