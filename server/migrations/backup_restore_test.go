package migrations

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func TestStoppedDataDirectoryCopyRestoresCampaignAndCatalogEdits(t *testing.T) {
	root := t.TempDir()
	sourceDir := filepath.Join(root, "source")
	restoreDir := filepath.Join(root, "restored")

	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: sourceDir, HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	system, err := app.FindFirstRecordByFilter("systems", "key = 'dnd5e'")
	if err != nil {
		t.Fatal(err)
	}
	game := saveBackupFixtureRecord(t, app, "games", map[string]any{
		"name":   "Backup fixture campaign",
		"system": system.Id,
	})
	catalog := saveBackupFixtureRecord(t, app, "catalog", map[string]any{
		"system":                system.Id,
		"type":                  "spell",
		"source":                "SYNTHETIC",
		"source_id":             "backup-fixture-spell",
		"name":                  "Invented Ember",
		"original_json":         map[string]any{"entries": []string{"Original invented text."}},
		"alternate_description": "A user-written alternate description.",
		"notes":                 "A private GM note.",
	})
	if err := app.ResetBootstrapState(); err != nil {
		t.Fatal(err)
	}

	if err := copyDirectory(sourceDir, restoreDir); err != nil {
		t.Fatalf("copy stopped data directory: %v", err)
	}

	restored := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: restoreDir, HideStartBanner: true})
	if err := restored.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer restored.ResetBootstrapState()
	if err := restored.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}

	restoredGame, err := restored.FindRecordById("games", game.Id)
	if err != nil || restoredGame.GetString("name") != "Backup fixture campaign" {
		t.Fatalf("campaign was not restored: record=%v err=%v", restoredGame, err)
	}
	restoredCatalog, err := restored.FindRecordById("catalog", catalog.Id)
	if err != nil {
		t.Fatal(err)
	}
	if restoredCatalog.GetString("source_id") != "backup-fixture-spell" ||
		restoredCatalog.GetString("alternate_description") != "A user-written alternate description." ||
		restoredCatalog.GetString("notes") != "A private GM note." ||
		restoredCatalog.Get("original_json") == nil {
		t.Fatalf("catalog source or user edits were not restored: %#v", restoredCatalog.PublicExport())
	}
}

func saveBackupFixtureRecord(t *testing.T, app core.App, collectionName string, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	for name, value := range fields {
		record.Set(name, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func copyDirectory(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			input.Close()
			return err
		}
		if _, err := io.Copy(output, input); err != nil {
			input.Close()
			output.Close()
			return err
		}
		if err := input.Close(); err != nil {
			output.Close()
			return err
		}
		return output.Close()
	})
}
