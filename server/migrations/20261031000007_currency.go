package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		for _, name := range []string{"cp", "sp", "ep", "gp", "pp"} {
			collection.Fields.Add(&core.NumberField{Name: name, OnlyInt: true, Min: pointer(0.0)})
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("inventories")
		if err != nil {
			return err
		}
		for _, name := range []string{"pp", "gp", "ep", "sp", "cp"} {
			collection.Fields.RemoveByName(name)
		}
		return app.Save(collection)
	})
}
