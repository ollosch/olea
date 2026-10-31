package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return err
		}
		inventories, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		stash := core.NewBaseCollection("stashes")
		stash.Fields.Add(&core.RelationField{Name: "game", Required: true, MaxSelect: 1, CollectionId: games.Id})
		stash.Fields.Add(&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{"party", "personal", "location"}})
		stash.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 160})
		stash.Fields.Add(&core.TextField{Name: "location", Max: 500})
		stash.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		stash.Fields.Add(&core.RelationField{Name: "owner", MaxSelect: 1, CollectionId: characters.Id})
		for _, name := range []string{"cp", "sp", "ep", "gp", "pp"} {
			stash.Fields.Add(&core.NumberField{Name: name, OnlyInt: true, Min: pointer(0.0)})
		}
		setPublicRules(stash)
		stash.AddIndex("idx_stashes_party", true, "game", "kind = 'party'")
		if err := app.Save(stash); err != nil {
			return err
		}
		inventories.Fields.Add(&core.RelationField{Name: "stash", MaxSelect: 1, CollectionId: stash.Id})
		inventories.AddIndex("idx_inventories_stash", true, "stash", "stash != ''")
		if err := app.Save(inventories); err != nil {
			return err
		}

		items, err := app.FindCollectionByNameOrId("inventory_items")
		if err != nil {
			return err
		}
		inventoryField, ok := items.Fields.GetByName("inventory").(*core.RelationField)
		if !ok {
			return fmt.Errorf("inventory relation field is missing")
		}
		inventoryField.Required = false
		items.Fields.Add(&core.RelationField{Name: "stash", MaxSelect: 1, CollectionId: stash.Id})
		items.AddIndex("idx_inventory_items_stash", false, "stash", "")
		if err := app.Save(items); err != nil {
			return err
		}
		return nil
	}, func(app core.App) error {
		items, err := app.FindCollectionByNameOrId("inventory_items")
		if err != nil {
			return err
		}
		items.Fields.RemoveByName("stash")
		inventoryField, ok := items.Fields.GetByName("inventory").(*core.RelationField)
		if !ok {
			return fmt.Errorf("inventory relation field is missing")
		}
		inventoryField.Required = true
		if err := app.Save(items); err != nil {
			return err
		}
		inventories, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		inventories.Fields.RemoveByName("stash")
		if err := app.Save(inventories); err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId("stashes")
		if err != nil {
			return err
		}
		return app.Delete(collection)
	})
}
