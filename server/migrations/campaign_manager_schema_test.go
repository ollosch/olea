package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase"
)

func TestCampaignManagerSchemaMigration(t *testing.T) {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"campaigns", "entities", "relation_types", "relations", "mentions", "maps", "map_markers"} {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Fatalf("collection %s is missing: %v", name, err)
		}
	}

	for _, check := range []struct {
		key          string
		hierarchical bool
	}{
		{key: "In", hierarchical: true},
		{key: "Übergruppe", hierarchical: true},
		{key: "Onkel", hierarchical: false},
	} {
		record, err := app.FindFirstRecordByData("relation_types", "key", check.key)
		if err != nil {
			t.Fatalf("relation type %s is missing: %v", check.key, err)
		}
		if record.GetBool("hierarchical") != check.hierarchical {
			t.Fatalf("relation type %s hierarchical = %v, want %v", check.key, record.GetBool("hierarchical"), check.hierarchical)
		}
	}

	if _, err := app.FindFirstRecordByData("systems", "key", "ose"); err != nil {
		t.Fatalf("system ose is missing: %v", err)
	}

	var names []string
	if err := app.DB().NewQuery("SELECT name FROM sqlite_master WHERE name IN ('entity_paths', 'entity_fts') ORDER BY name").Column(&names); err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, name := range names {
		found[name] = true
	}
	for _, name := range []string{"entity_paths", "entity_fts"} {
		if !found[name] {
			t.Fatalf("%s is missing from sqlite_master", name)
		}
	}
}
