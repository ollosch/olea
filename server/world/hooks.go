package world

import (
	"github.com/pocketbase/pocketbase/core"
)

// RegisterHooks installs the relation, path and FTS maintenance hooks.
func RegisterHooks(app core.App) {
	app.OnRecordAfterCreateSuccess("entities").BindFunc(syncEntityHook)
	app.OnRecordAfterUpdateSuccess("entities").BindFunc(syncEntityHook)
	app.OnRecordAfterDeleteSuccess("entities").BindFunc(deleteEntityHook)
	app.OnRecordAfterCreateSuccess("relations").BindFunc(rebuildPathsHook)
	app.OnRecordAfterUpdateSuccess("relations").BindFunc(rebuildPathsHook)
	app.OnRecordAfterDeleteSuccess("relations").BindFunc(rebuildPathsHook)
	app.OnRecordAfterCreateSuccess("relation_types").BindFunc(rebuildPathsHook)
	app.OnRecordAfterUpdateSuccess("relation_types").BindFunc(rebuildPathsHook)
	app.OnRecordAfterDeleteSuccess("relation_types").BindFunc(rebuildPathsHook)
}

func schemaReady(app core.App) bool {
	var count int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('entity_paths', 'entity_fts')").Row(&count); err != nil {
		return false
	}
	return count == 2
}

func syncEntityHook(e *core.RecordEvent) error {
	if !schemaReady(e.App) {
		return e.Next()
	}
	if err := e.App.RunInTransaction(func(txApp core.App) error {
		resolver, err := LoadResolver(txApp)
		if err != nil {
			return err
		}
		if _, err := SyncEntityRelations(txApp, e.Record, resolver); err != nil {
			return err
		}
		if _, err := SyncEntityMentions(txApp, e.Record, resolver); err != nil {
			return err
		}
		if _, err := RebuildPaths(txApp); err != nil {
			return err
		}
		return RefreshEntityFTS(txApp, e.Record)
	}); err != nil {
		return err
	}
	return e.Next()
}

func deleteEntityHook(e *core.RecordEvent) error {
	if !schemaReady(e.App) {
		return e.Next()
	}
	if err := e.App.RunInTransaction(func(txApp core.App) error {
		if _, err := RebuildPaths(txApp); err != nil {
			return err
		}
		return DeleteEntityFTS(txApp, e.Record.Id)
	}); err != nil {
		return err
	}
	return e.Next()
}

func rebuildPathsHook(e *core.RecordEvent) error {
	if !schemaReady(e.App) {
		return e.Next()
	}
	if err := e.App.RunInTransaction(func(txApp core.App) error {
		_, err := RebuildPaths(txApp)
		return err
	}); err != nil {
		return err
	}
	return e.Next()
}
