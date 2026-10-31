package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return err
		}
		catalog, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		encounters := core.NewBaseCollection("encounters")
		encounters.Fields.Add(&core.RelationField{Name: "game", Required: true, MaxSelect: 1, CollectionId: games.Id, CascadeDelete: true})
		encounters.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 160})
		setPublicRules(encounters)
		encounters.AddIndex("idx_encounters_game", false, "game", "")
		if err := app.Save(encounters); err != nil {
			return err
		}
		entries := core.NewBaseCollection("encounter_creatures")
		entries.Fields.Add(&core.RelationField{Name: "encounter", Required: true, MaxSelect: 1, CollectionId: encounters.Id, CascadeDelete: true})
		entries.Fields.Add(&core.RelationField{Name: "creature", MaxSelect: 1, CollectionId: catalog.Id})
		entries.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 255})
		entries.Fields.Add(&core.NumberField{Name: "quantity", Required: true, OnlyInt: true, Min: pointer(1.0), Max: pointer(100.0)})
		entries.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
		entries.Fields.Add(&core.BoolField{Name: "custom"})
		setPublicRules(entries)
		entries.AddIndex("idx_encounter_creatures_encounter", false, "encounter", "")
		if err := app.Save(entries); err != nil {
			return err
		}
		combat := core.NewBaseCollection("combats")
		combat.Fields.Add(&core.RelationField{Name: "encounter", Required: true, MaxSelect: 1, CollectionId: encounters.Id})
		combat.Fields.Add(&core.BoolField{Name: "active"})
		combat.Fields.Add(&core.NumberField{Name: "round", OnlyInt: true, Min: pointer(1.0)})
		combat.Fields.Add(&core.NumberField{Name: "turn", OnlyInt: true, Min: pointer(0.0)})
		combat.Fields.Add(&core.TextField{Name: "tie_order", Max: 100000})
		combat.Fields.Add(&core.TextField{Name: "name", Max: 160})
		for _, key := range []string{"visible", "show_initiative", "show_enemy_names", "show_hp", "show_conditions"} {
			combat.Fields.Add(&core.BoolField{Name: key})
		}
		setPublicRules(combat)
		combat.AddIndex("idx_combats_encounter_active", false, "encounter", "active = 1")
		if err := app.Save(combat); err != nil {
			return err
		}
		participants := core.NewBaseCollection("combatants")
		participants.Fields.Add(&core.RelationField{Name: "combat", Required: true, MaxSelect: 1, CollectionId: combat.Id, CascadeDelete: true})
		participants.Fields.Add(&core.RelationField{Name: "character", MaxSelect: 1, CollectionId: characters.Id})
		participants.Fields.Add(&core.RelationField{Name: "prepared", MaxSelect: 1, CollectionId: entries.Id})
		participants.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 255})
		participants.Fields.Add(&core.BoolField{Name: "enemy"})
		participants.Fields.Add(&core.NumberField{Name: "current_hp", Min: pointer(0.0)})
		participants.Fields.Add(&core.NumberField{Name: "max_hp", Min: pointer(0.0)})
		participants.Fields.Add(&core.BoolField{Name: "hp_known"})
		participants.Fields.Add(&core.TextField{Name: "hp_formula", Max: 120})
		participants.Fields.Add(&core.NumberField{Name: "dexterity_modifier", Min: pointer(-10.0), Max: pointer(10.0)})
		participants.Fields.Add(&core.BoolField{Name: "dexterity_known"})
		participants.Fields.Add(&core.NumberField{Name: "initiative"})
		participants.Fields.Add(&core.BoolField{Name: "initiative_known"})
		participants.Fields.Add(&core.NumberField{Name: "initiative_modifier"})
		participants.Fields.Add(&core.BoolField{Name: "initiative_modifier_override"})
		participants.Fields.Add(&core.TextField{Name: "conditions", Max: 10000})
		participants.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
		participants.Fields.Add(&core.NumberField{Name: "sort_order", OnlyInt: true, Min: pointer(0.0)})
		setPublicRules(participants)
		participants.AddIndex("idx_combatants_combat", false, "combat", "")
		return app.Save(participants)
	}, func(app core.App) error {
		for _, name := range []string{"combatants", "combats", "encounter_creatures", "encounters"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}
