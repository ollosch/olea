package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.NumberField{Name: "hp_average"})
		collection.Fields.Add(&core.TextField{Name: "hp_formula", Max: 120})
		collection.Fields.Add(&core.NumberField{Name: "dexterity"})
		collection.Fields.Add(&core.JSONField{Name: "actions_json"})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		for _, name := range []string{"actions_json", "dexterity", "hp_formula", "hp_average"} {
			collection.Fields.RemoveByName(name)
		}
		return app.Save(collection)
	})
}
