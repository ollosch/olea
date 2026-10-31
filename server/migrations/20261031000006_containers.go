package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		inventories, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		inventories.Fields.Add(&core.NumberField{Name: "capacity", Min: pointer(0.0)})
		inventories.Fields.Add(&core.BoolField{Name: "capacity_known"})
		if err := app.Save(inventories); err != nil {
			return err
		}

		items, err := app.FindCollectionByNameOrId("inventory_items")
		if err != nil {
			return err
		}
		items.Fields.Add(&core.BoolField{Name: "weight_known"})
		items.Fields.Add(&core.BoolField{Name: "is_container"})
		items.Fields.Add(&core.RelationField{Name: "container", MaxSelect: 1, CollectionId: items.Id})
		return app.Save(items)
	}, func(app core.App) error {
		items, err := app.FindCollectionByNameOrId("inventory_items")
		if err != nil {
			return err
		}
		for _, name := range []string{"container", "is_container", "weight_known"} {
			items.Fields.RemoveByName(name)
		}
		if err := app.Save(items); err != nil {
			return err
		}
		inventories, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		inventories.Fields.RemoveByName("capacity_known")
		inventories.Fields.RemoveByName("capacity")
		return app.Save(inventories)
	})
}

func pointer(value float64) *float64 { return &value }
