package migrations

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		catalog, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		catalog.Fields.Add(&core.TextField{Name: "sphere", Max: 1000}, &core.TextField{Name: "book_source", Max: 1000})
		if err := app.Save(catalog); err != nil {
			return err
		}
		_, err = app.FindFirstRecordByData("systems", "key", "adnd2e")
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}
		system := core.NewRecord(systems)
		system.Set("key", "adnd2e")
		system.Set("name", "AD&D 2e")
		return app.Save(system)
	}, func(app core.App) error {
		catalog, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		catalog.Fields.RemoveByName("sphere")
		catalog.Fields.RemoveByName("book_source")
		return app.Save(catalog)
	})
}
