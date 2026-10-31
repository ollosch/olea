package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		catalog, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}

		inventories := core.NewBaseCollection("inventories")
		inventories.Fields.Add(&core.RelationField{Name: "game", Required: true, MaxSelect: 1, CollectionId: games.Id})
		inventories.Fields.Add(&core.RelationField{Name: "character", MaxSelect: 1, CollectionId: characters.Id})
		setPublicRules(inventories)
		inventories.AddIndex("idx_inventories_character", true, "character", "character != ''")
		if err := app.Save(inventories); err != nil {
			return err
		}

		items := core.NewBaseCollection("inventory_items")
		items.Fields.Add(&core.RelationField{Name: "inventory", Required: true, MaxSelect: 1, CollectionId: inventories.Id})
		items.Fields.Add(&core.RelationField{Name: "catalog_item", MaxSelect: 1, CollectionId: catalog.Id})
		items.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 240})
		items.Fields.Add(&core.NumberField{Name: "quantity", Required: true, OnlyInt: true, Min: types.Pointer[float64](1)})
		items.Fields.Add(&core.NumberField{Name: "weight", Min: types.Pointer[float64](0)})
		items.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
		setPublicRules(items)
		items.AddIndex("idx_inventory_items_inventory", false, "inventory", "")
		if err := app.Save(items); err != nil {
			return err
		}
		return nil
	}, func(app core.App) error {
		for _, name := range []string{"inventory_items", "inventories"} {
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
