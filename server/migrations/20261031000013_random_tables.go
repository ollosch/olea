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
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}
		tables := core.NewBaseCollection("random_tables")
		tables.Fields.Add(&core.RelationField{Name: "game", Required: true, MaxSelect: 1, CollectionId: games.Id, CascadeDelete: true}, &core.TextField{Name: "name", Required: true, Max: 160}, &core.TextField{Name: "dice", Max: 120}, &core.JSONField{Name: "entries", Required: true, MaxSize: 1000000})
		tables.ListRule, tables.ViewRule = types.Pointer(""), types.Pointer("")
		tables.AddIndex("idx_random_tables_game", false, "game", "")
		if err := app.Save(tables); err != nil {
			return err
		}
		templates := core.NewBaseCollection("table_templates")
		templates.Fields.Add(&core.RelationField{Name: "system", Required: true, MaxSelect: 1, CollectionId: systems.Id, CascadeDelete: true}, &core.TextField{Name: "source", Required: true, Max: 120}, &core.TextField{Name: "source_id", Required: true, Max: 120}, &core.TextField{Name: "name", Required: true, Max: 160}, &core.TextField{Name: "dice", Max: 120}, &core.JSONField{Name: "entries", Required: true, MaxSize: 1000000})
		templates.ListRule, templates.ViewRule = types.Pointer(""), types.Pointer("")
		templates.AddIndex("idx_table_templates_identity", true, "system, source, source_id", "")
		return app.Save(templates)
	}, func(app core.App) error {
		for _, name := range []string{"table_templates", "random_tables"} {
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
