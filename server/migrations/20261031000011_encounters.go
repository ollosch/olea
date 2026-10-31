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
		return app.Save(entries)
	}, func(app core.App) error {
		for _, name := range []string{"encounter_creatures", "encounters"} {
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
