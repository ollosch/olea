package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		catalog, err := app.FindCollectionByNameOrId("catalog")
		if err != nil {
			return err
		}
		books := core.NewBaseCollection("spellbooks")
		books.Fields.Add(&core.RelationField{Name: "character", Required: true, MaxSelect: 1, CollectionId: characters.Id})
		books.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 160})
		setPublicRules(books)
		books.AddIndex("idx_spellbooks_character", false, "character", "")
		if err := app.Save(books); err != nil {
			return err
		}
		spells := core.NewBaseCollection("spellbook_spells")
		spells.Fields.Add(&core.RelationField{Name: "spellbook", Required: true, MaxSelect: 1, CollectionId: books.Id})
		spells.Fields.Add(&core.RelationField{Name: "spell", Required: true, MaxSelect: 1, CollectionId: catalog.Id})
		setPublicRules(spells)
		spells.AddIndex("idx_spellbook_spell_identity", true, "spellbook,spell", "")
		if err := app.Save(spells); err != nil {
			return err
		}
		return nil
	}, func(app core.App) error {
		for _, name := range []string{"spellbook_spells", "spellbooks"} {
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
