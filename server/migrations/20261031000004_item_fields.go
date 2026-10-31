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
		collection.Fields.Add(&core.JSONField{Name: "item_type"})
		collection.Fields.Add(&core.JSONField{Name: "item_weight"})
		collection.Fields.Add(&core.JSONField{Name: "item_value"})
		collection.Fields.Add(&core.TextField{Name: "rarity", Max: 120})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		for _, name := range []string{"rarity", "item_value", "item_weight", "item_type"} {
			collection.Fields.RemoveByName(name)
		}
		return app.Save(collection)
	})
}
