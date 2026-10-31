package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("profiles")
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.TextField{
			Name: "accent",
			Max:  7,
		})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("profiles")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("accent")
		return app.Save(collection)
	})
}
