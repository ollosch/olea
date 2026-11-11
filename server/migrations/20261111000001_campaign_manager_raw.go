package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		statements := []string{
			`CREATE TABLE IF NOT EXISTS entity_paths (
				ancestor_id TEXT NOT NULL,
				descendant_id TEXT NOT NULL,
				depth INTEGER NOT NULL,
				PRIMARY KEY (ancestor_id, descendant_id, depth)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_entity_paths_descendant_ancestor ON entity_paths (descendant_id, ancestor_id)`,
			`CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
				entity_id UNINDEXED,
				name,
				body,
				type_class,
				template,
				folder
			)`,
		}
		for _, statement := range statements {
			if _, err := app.DB().NewQuery(statement).Execute(); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		statements := []string{
			`DROP TABLE IF EXISTS entity_fts`,
			`DROP INDEX IF EXISTS idx_entity_paths_descendant_ancestor`,
			`DROP TABLE IF EXISTS entity_paths`,
		}
		for _, statement := range statements {
			if _, err := app.DB().NewQuery(statement).Execute(); err != nil {
				return err
			}
		}
		return nil
	})
}
