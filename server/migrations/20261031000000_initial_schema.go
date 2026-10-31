package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		systems := core.NewBaseCollection("systems")
		systems.Fields.Add(&core.TextField{
			Name:     "key",
			Required: true,
			Max:      64,
		})
		systems.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      120,
		})
		systems.ListRule = types.Pointer("")
		systems.ViewRule = types.Pointer("")
		systems.AddIndex("idx_systems_key", true, "key", "")
		if err := app.Save(systems); err != nil {
			return err
		}

		profiles := core.NewBaseCollection("profiles")
		profiles.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      120,
		})
		setPublicRules(profiles)
		if err := app.Save(profiles); err != nil {
			return err
		}

		games := core.NewBaseCollection("games")
		games.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      160,
		})
		games.Fields.Add(&core.RelationField{
			Name:         "system",
			Required:     true,
			Max:          1,
			CollectionId: systems.Id,
		})
		games.Fields.Add(&core.RelationField{
			Name:         "gm_profile",
			Max:          1,
			CollectionId: profiles.Id,
		})
		setPublicRules(games)
		if err := app.Save(games); err != nil {
			return err
		}

		characters := core.NewBaseCollection("characters")
		characters.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      160,
		})
		characters.Fields.Add(&core.RelationField{
			Name:         "game",
			Required:     true,
			Max:          1,
			CollectionId: games.Id,
		})
		characters.Fields.Add(&core.RelationField{
			Name:         "owner",
			Max:          1,
			CollectionId: profiles.Id,
		})
		setPublicRules(characters)
		if err := app.Save(characters); err != nil {
			return err
		}

		systemRecord := core.NewRecord(systems)
		systemRecord.Set("key", "dnd5e")
		systemRecord.Set("name", "D&D 5e")
		return app.Save(systemRecord)
	}, func(app core.App) error {
		for _, name := range []string{"characters", "games", "profiles", "systems"} {
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

func setPublicRules(collection *core.Collection) {
	collection.ListRule = types.Pointer("")
	collection.ViewRule = types.Pointer("")
	collection.CreateRule = types.Pointer("")
	collection.UpdateRule = types.Pointer("")
	collection.DeleteRule = types.Pointer("")
}
