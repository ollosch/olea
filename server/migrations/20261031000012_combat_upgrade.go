package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Encounter preparation was shipped first. Older databases can lack the live
// collections, because their original encounter migration already ran.
func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return err
		}
		for _, name := range []string{"encounter_visible", "encounter_show_initiative", "encounter_show_enemy_names", "encounter_show_hp", "encounter_show_conditions"} {
			if games.Fields.GetByName(name) == nil {
				games.Fields.Add(&core.BoolField{Name: name})
			}
		}
		if err := app.Save(games); err != nil {
			return err
		}
		encounters, err := app.FindCollectionByNameOrId("encounters")
		if err != nil {
			return err
		}
		entries, err := app.FindCollectionByNameOrId("encounter_creatures")
		if err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		combat, err := app.FindCollectionByNameOrId("combats")
		if err != nil {
			combat = core.NewBaseCollection("combats")
			combat.Fields.Add(&core.RelationField{Name: "encounter", Required: true, MaxSelect: 1, CollectionId: encounters.Id, CascadeDelete: true})
			combat.Fields.Add(&core.BoolField{Name: "active"})
			combat.Fields.Add(&core.NumberField{Name: "round", OnlyInt: true, Min: pointer(1.0)})
			combat.Fields.Add(&core.NumberField{Name: "turn", OnlyInt: true, Min: pointer(0.0)})
			combat.Fields.Add(&core.TextField{Name: "tie_order", Max: 100000})
			combat.Fields.Add(&core.TextField{Name: "name", Max: 160})
			for _, name := range []string{"visible", "show_initiative", "show_enemy_names", "show_hp", "show_conditions"} {
				combat.Fields.Add(&core.BoolField{Name: name})
			}
			setPublicRules(combat)
			combat.AddIndex("idx_combats_encounter_active", false, "encounter", "active = 1")
		} else if field, ok := combat.Fields.GetByName("encounter").(*core.RelationField); ok {
			field.CascadeDelete = true
		}
		if err := app.Save(combat); err != nil {
			return err
		}
		participants, err := app.FindCollectionByNameOrId("combatants")
		if err != nil {
			participants = core.NewBaseCollection("combatants")
			participants.Fields.Add(&core.RelationField{Name: "combat", Required: true, MaxSelect: 1, CollectionId: combat.Id, CascadeDelete: true})
			participants.Fields.Add(&core.RelationField{Name: "character", MaxSelect: 1, CollectionId: characters.Id})
			participants.Fields.Add(&core.RelationField{Name: "prepared", MaxSelect: 1, CollectionId: entries.Id})
			participants.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 255})
			participants.Fields.Add(&core.BoolField{Name: "enemy"})
			participants.Fields.Add(&core.NumberField{Name: "current_hp", Min: pointer(0.0)})
			participants.Fields.Add(&core.NumberField{Name: "max_hp", Min: pointer(0.0)})
			participants.Fields.Add(&core.BoolField{Name: "hp_known"})
			participants.Fields.Add(&core.NumberField{Name: "initiative"})
			participants.Fields.Add(&core.BoolField{Name: "initiative_known"})
			participants.Fields.Add(&core.NumberField{Name: "initiative_modifier"})
			participants.Fields.Add(&core.BoolField{Name: "initiative_modifier_override"})
			participants.Fields.Add(&core.TextField{Name: "conditions", Max: 10000})
			participants.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
			participants.Fields.Add(&core.NumberField{Name: "sort_order", OnlyInt: true, Min: pointer(0.0)})
			setPublicRules(participants)
			participants.AddIndex("idx_combatants_combat", false, "combat", "")
		}
		if participants.Fields.GetByName("hp_formula") == nil {
			participants.Fields.Add(&core.TextField{Name: "hp_formula", Max: 120})
		}
		if participants.Fields.GetByName("dexterity_modifier") == nil {
			participants.Fields.Add(&core.NumberField{Name: "dexterity_modifier", Min: pointer(-10.0), Max: pointer(10.0)})
		}
		if participants.Fields.GetByName("dexterity_known") == nil {
			participants.Fields.Add(&core.BoolField{Name: "dexterity_known"})
		}
		return app.Save(participants)
	}, func(app core.App) error {
		participants, err := app.FindCollectionByNameOrId("combatants")
		if err != nil {
			return err
		}
		for _, name := range []string{"hp_formula", "dexterity_modifier", "dexterity_known"} {
			participants.Fields.RemoveByName(name)
		}
		if err := app.Save(participants); err != nil {
			return err
		}
		combat, err := app.FindCollectionByNameOrId("combats")
		if err != nil {
			return err
		}
		if field, ok := combat.Fields.GetByName("encounter").(*core.RelationField); ok {
			field.CascadeDelete = false
		}
		if err := app.Save(combat); err != nil {
			return err
		}
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return err
		}
		for _, name := range []string{"encounter_visible", "encounter_show_initiative", "encounter_show_enemy_names", "encounter_show_hp", "encounter_show_conditions"} {
			games.Fields.RemoveByName(name)
		}
		return app.Save(games)
	})
}
