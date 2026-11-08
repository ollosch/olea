<script setup lang="ts">
import type { CreatureHP, SystemCapabilities } from '../../lib/systems'
import type {
  Character,
  Combat,
  Combatant,
  CombatDraft,
  DisplaySettingField,
  Game,
  HPPreview,
  HPMode,
} from '../../lib/encounterModel'

defineProps<{
  game: Game
  combat: Combat | null
  rules: SystemCapabilities['encounter']
  gameCharacters: Character[]
  combatants: Combatant[]
  activeCombatant: Combatant | null
  hpPreview: Record<string, HPPreview>
  diceError: string
  canStart: boolean
  hpSourceFor: (participant: Combatant) => CreatureHP
}>()

const emit = defineEmits<{
  start: []
  reset: []
  end: []
  previous: []
  next: []
  'roll-group': []
  'add-character': [id: string]
  'add-custom': []
  'save-combatant': [participant: Combatant]
  'preview-hp': [participant: Combatant, mode: HPMode]
  'confirm-hp': [participant: Combatant]
  'remove-combatant': [participant: Combatant]
  'roll-one': [participant: Combatant]
  'set-tie-order': [participant: Combatant, direction: number]
  'save-display-setting': [field: DisplaySettingField, value: boolean]
}>()

const drafts = defineModel<Record<string, CombatDraft>>('drafts', { required: true })
const selectedForGroup = defineModel<string[]>('selectedForGroup', { required: true })
const initiativeModifiers = defineModel<Record<string, number | ''>>('initiativeModifiers', { required: true })
const customParticipantName = defineModel<string>('customParticipantName', { required: true })

function addCharacter(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) emit('add-character', select.value)
  select.value = ''
}

function saveDisplaySetting(field: DisplaySettingField, event: Event) {
  emit('save-display-setting', field, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <section class="encounter-live" :class="{ 'is-active': combat?.active }" aria-labelledby="encounter-live-title">
    <div class="combat-panel">
      <div class="spellbook-heading">
        <div>
          <p class="eyebrow">LIVE PLAY · ACTIVE COMBAT</p>
          <h2 id="encounter-live-title">{{ combat?.active ? 'Combat in progress' : 'Ready to start' }}</h2>
          <p v-if="combat?.active" class="encounter-section-note">Changes here affect this combat only. The reusable preparation above stays unchanged.</p>
          <p v-else class="encounter-section-note">Starting combat copies the prepared creature quantities into a separate live tracker; later preparation edits do not change it.</p>
        </div>
        <div class="row-actions">
          <RouterLink v-if="combat?.active && game.encounter_visible" class="secondary-link" :to="{ name: 'player-encounter', params: { gameId: game.id } }">Player view</RouterLink>
          <button v-if="!combat?.active" class="primary-button" type="button" :disabled="!canStart" @click="emit('start')">Start combat</button>
          <template v-else>
            <span class="round-pill">Round {{ combat.round }}</span>
            <button class="secondary-button" type="button" @click="emit('reset')">Reset</button>
            <button class="danger-button" type="button" @click="emit('end')">End combat</button>
          </template>
        </div>
      </div>
      <template v-if="combat?.active">
        <details class="player-display-settings">
          <summary>Player display settings</summary>
          <p>These settings hide details in the player-facing UI only; they are not access controls on this trusted LAN.</p>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_visible" @change="saveDisplaySetting('encounter_visible', $event)" /> Show active encounter</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_initiative" @change="saveDisplaySetting('encounter_show_initiative', $event)" /> Show initiative</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_enemy_names" @change="saveDisplaySetting('encounter_show_enemy_names', $event)" /> Show enemy names</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_hp" @change="saveDisplaySetting('encounter_show_hp', $event)" /> Show enemy HP</label>
          <label class="check-field"><input type="checkbox" :checked="game.encounter_show_conditions" @change="saveDisplaySetting('encounter_show_conditions', $event)" /> Show conditions</label>
        </details>
        <p v-if="diceError" class="field-error" role="alert">{{ diceError }}</p>
        <div class="turn-controls">
          <button class="secondary-button" type="button" :disabled="!combatants.length" @click="emit('previous')">← Previous</button>
          <p v-if="activeCombatant"><strong>Active:</strong> {{ activeCombatant.name }}</p>
          <p v-else>No participants yet</p>
          <button class="secondary-button" type="button" :disabled="!combatants.length" @click="emit('next')">Next →</button>
        </div>
        <div v-if="rules.initiative" class="group-roll">
          <span>{{ rules.initiative.groupLabel }}</span>
          <button class="secondary-button" type="button" :disabled="!selectedForGroup.length" @click="emit('roll-group')">Roll group</button>
        </div>
        <p v-else class="muted-hint">Initiative and turn order are manual. Use the arrows to arrange participants.</p>
        <div class="participant-add">
          <label class="filter-field">Add character
            <select class="select-input" :disabled="gameCharacters.every((character) => combatants.some((entry) => entry.character === character.id))" @change="addCharacter">
              <option value="">Choose a character</option>
              <option v-for="character in gameCharacters.filter((entry) => !combatants.some((participant) => participant.character === entry.id))" :key="character.id" :value="character.id">{{ character.name }}</option>
            </select>
          </label>
          <form class="custom-participant-form" @submit.prevent="emit('add-custom')">
            <label class="filter-field">Add custom participant<input v-model="customParticipantName" class="text-input" maxlength="255" placeholder="Name" /></label>
            <button class="secondary-button" type="submit">Add</button>
          </form>
        </div>
        <div v-if="combatants.length" class="combatant-list">
          <article v-for="participant in combatants" :key="participant.id" class="combatant-card" :class="{ active: activeCombatant?.id === participant.id }">
            <div class="combatant-title">
              <div>
                <strong>{{ participant.name }}</strong>
                <small>{{ participant.enemy ? 'Enemy' : participant.character ? 'Character' : 'Participant' }}<template v-if="participant.prepared && participant.expand?.prepared?.expand?.creature"> · {{ participant.expand.prepared.expand.creature.source }}</template></small>
              </div>
              <div class="row-actions">
                <label v-if="rules.initiative" class="select-combatant"><input v-model="selectedForGroup" type="checkbox" :value="participant.id" /> Select</label>
                <span class="initiative-pill">{{ participant.initiative_known ? `Init ${participant.initiative}` : 'No initiative' }}</span>
                <button class="icon-button tie-button" type="button" aria-label="Move participant up" title="Move up" @click="emit('set-tie-order', participant, -1)">↑</button>
                <button class="icon-button tie-button" type="button" aria-label="Move participant down" title="Move down" @click="emit('set-tie-order', participant, 1)">↓</button>
                <button v-if="rules.initiative" class="secondary-button" type="button" @click="emit('roll-one', participant)">Roll</button>
                <button class="danger-button" type="button" @click="emit('remove-combatant', participant)">Remove</button>
              </div>
            </div>
            <div class="combatant-fields">
              <label class="filter-field">Initiative<input v-model.number="drafts[participant.id]!.initiative" class="text-input" type="number" step="any" placeholder="—" /></label>
              <label v-if="rules.initiative" class="filter-field">Initiative modifier<input v-model.number="initiativeModifiers[participant.id]" class="text-input" type="number" min="-20" max="20" step="1" :placeholder="participant.dexterity_known ? String(participant.dexterity_modifier) : 'Manual or unset'" /></label>
              <label class="filter-field">Current HP<input v-model.number="drafts[participant.id]!.current_hp" class="text-input" type="number" min="0" step="any" placeholder="—" /></label>
              <label class="filter-field">Max HP<input v-model.number="drafts[participant.id]!.max_hp" class="text-input" type="number" min="0" step="any" placeholder="—" /></label>
              <label class="filter-field">Conditions<input v-model="drafts[participant.id]!.conditions" class="text-input" placeholder="e.g. prone" /></label>
              <label class="filter-field">Notes<input v-model="drafts[participant.id]!.notes" class="text-input" placeholder="Notes" /></label>
              <button class="secondary-button" type="button" @click="emit('save-combatant', participant)">Save</button>
            </div>
            <div v-if="participant.enemy" class="hp-roll-controls">
              <span>HP {{ participant.hp_known ? `${participant.current_hp}/${participant.max_hp}` : 'not set' }}</span>
              <button v-if="hpSourceFor(participant).average !== null" class="inline-button" type="button" @click="emit('preview-hp', participant, 'average')">Use average</button>
              <button v-if="hpSourceFor(participant).formula" class="inline-button" type="button" @click="emit('preview-hp', participant, 'roll')">Roll HP</button>
              <button class="inline-button" type="button" @click="emit('preview-hp', participant, 'manual')">Preview manual</button>
              <span v-if="hpPreview[participant.id]" class="preview-confirm">Preview: {{ hpPreview[participant.id]!.current }}/{{ hpPreview[participant.id]!.max }} <button class="secondary-button" type="button" @click="emit('confirm-hp', participant)">Confirm HP</button></span>
            </div>
          </article>
        </div>
        <p v-else class="muted-hint">No live participants. Add game characters or custom participants.</p>
      </template>
    </div>
  </section>
</template>
