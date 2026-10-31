package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Owned records must be removed together with their parent, including when a
// game is deleted directly rather than through the UI.
func init() {
	relations := map[string][]string{
		"characters":       {"game"},
		"inventories":      {"game", "character"},
		"stashes":          {"game", "owner"},
		"inventory_items":  {"inventory", "stash"},
		"spellbooks":       {"character"},
		"spellbook_spells": {"spellbook"},
	}
	update := func(app core.App, cascade bool) error {
		for name, fields := range relations {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			for _, name := range fields {
				field, ok := collection.Fields.GetByName(name).(*core.RelationField)
				if !ok {
					return fmt.Errorf("missing relation %s.%s", collection.Name, name)
				}
				field.CascadeDelete = cascade
			}
			if err := app.Save(collection); err != nil {
				return err
			}
		}
		return nil
	}
	m.Register(func(app core.App) error { return update(app, true) }, func(app core.App) error { return update(app, false) })
}
