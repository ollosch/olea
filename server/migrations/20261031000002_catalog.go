package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}
		catalog := core.NewBaseCollection("catalog")
		catalog.Fields.Add(&core.RelationField{
			Name:         "system",
			Required:     true,
			MaxSelect:    1,
			CollectionId: systems.Id,
		})
		catalog.Fields.Add(&core.SelectField{
			Name:      "type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"item", "spell", "creature"},
		})
		catalog.Fields.Add(&core.TextField{
			Name:     "source",
			Required: true,
			Max:      120,
		})
		catalog.Fields.Add(&core.TextField{
			Name:     "source_id",
			Required: true,
			Max:      200,
		})
		catalog.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      255,
		})
		catalog.Fields.Add(&core.TextField{Name: "level", Max: 40})
		catalog.Fields.Add(&core.TextField{Name: "school", Max: 80})
		catalog.Fields.Add(&core.TextField{Name: "creature_type", Max: 120})
		catalog.Fields.Add(&core.TextField{Name: "challenge_rating", Max: 40})
		catalog.Fields.Add(&core.JSONField{Name: "original_json", Required: true})
		catalog.Fields.Add(&core.TextField{Name: "alternate_description", Max: 100000})
		catalog.Fields.Add(&core.TextField{Name: "notes", Max: 100000})
		catalog.AddIndex("idx_catalog_identity", true, "system,type,source,source_id", "")
		setPublicRules(catalog)
		return app.Save(catalog)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		return app.Delete(collection)
	})
}
