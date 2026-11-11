package world

import (
	"sort"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	_ "olea/migrations"
)

func newWorldTestApp(t *testing.T) core.App {
	t.Helper()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: t.TempDir(), HideStartBanner: true})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	return app
}

func createCampaign(t *testing.T, app core.App, key, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCachedCollectionByNameOrId("campaigns")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Set("key", key)
	record.Set("name", name)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func createEntity(t *testing.T, app core.App, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCachedCollectionByNameOrId("entities")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	for key, value := range fields {
		record.Set(key, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func itemIDs(result SearchResult) []string {
	ids := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	sort.Strings(ids)
	return ids
}

func itemNames(result SearchResult) []string {
	names := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		names = append(names, item.Name)
	}
	return names
}

func TestSearch(t *testing.T) {
	app := newWorldTestApp(t)
	alpha := createCampaign(t, app, "alpha", "Alpha")
	beta := createCampaign(t, app, "beta", "Beta")

	alderKeep := createEntity(t, app, map[string]any{
		"name":       "Alder Keep",
		"type_class": "location",
		"template":   "settlement",
		"folder":     "World/Locations",
		"body":       "# Keep\n\nA quizzacious fortress of dragons.",
		"campaigns":  []string{alpha.Id},
	})
	alderwood := createEntity(t, app, map[string]any{
		"name":       "Alderwood",
		"type_class": "actor",
		"template":   "npc",
		"folder":     "World/Actors",
		"body":       "A quiet forest elder.",
		"campaigns":  []string{beta.Id},
	})
	globalGrove := createEntity(t, app, map[string]any{
		"name":       "Global Grove",
		"type_class": "location",
		"template":   "poi",
		"folder":     "World/Locations",
		"body":       "A quizzacious grove.",
	})
	thread := createEntity(t, app, map[string]any{
		"name":       "Ancient Thread",
		"type_class": "thread",
		"template":   "quest",
		"folder":     "Timeline/Threads",
		"body":       "A thread about a quizzacious artifact.",
	})
	if _, err := RebuildFTS(app); err != nil {
		t.Fatal(err)
	}

	t.Run("fts", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "quizzacious"})
		if err != nil {
			t.Fatal(err)
		}
		want := []string{alderKeep.Id, globalGrove.Id, thread.Id}
		sort.Strings(want)
		if got := itemIDs(result); len(got) != len(want) {
			t.Fatalf("ids = %#v, want %#v", got, want)
		} else {
			for index := range want {
				if got[index] != want[index] {
					t.Fatalf("ids = %#v, want %#v", got, want)
				}
			}
		}
		for _, item := range result.Items {
			if item.Snippet == "" {
				t.Fatalf("item %q has empty snippet", item.Name)
			}
		}
	})

	t.Run("prefix", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "quizz"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 3 {
			t.Fatalf("prefix matches = %#v, want 3 items", itemNames(result))
		}
		result, err = Search(app, SearchParams{Query: "ald"})
		if err != nil {
			t.Fatal(err)
		}
		want := []string{alderKeep.Id, alderwood.Id}
		sort.Strings(want)
		if got := itemIDs(result); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("prefix ids = %#v, want %#v", got, want)
		}
	})

	t.Run("type filter", func(t *testing.T) {
		result, err := Search(app, SearchParams{Type: "location"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 2 {
			t.Fatalf("location items = %#v, want 2", itemNames(result))
		}
		for _, item := range result.Items {
			if item.TypeClass != "location" {
				t.Fatalf("item %q type_class = %q", item.Name, item.TypeClass)
			}
		}
	})

	t.Run("campaign filter", func(t *testing.T) {
		for _, campaign := range []string{"alpha", alpha.Id} {
			result, err := Search(app, SearchParams{Campaign: campaign})
			if err != nil {
				t.Fatal(err)
			}
			want := []string{alderKeep.Id, globalGrove.Id, thread.Id}
			sort.Strings(want)
			if got := itemIDs(result); len(got) != len(want) {
				t.Fatalf("campaign %q ids = %#v, want %#v", campaign, got, want)
			} else {
				for index := range want {
					if got[index] != want[index] {
						t.Fatalf("campaign %q ids = %#v, want %#v", campaign, got, want)
					}
				}
			}
		}
	})

	t.Run("campaign keys", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "fortress"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 1 {
			t.Fatalf("fortress items = %#v", itemNames(result))
		}
		item := result.Items[0]
		if len(item.Campaigns) != 1 || item.Campaigns[0] != "alpha" {
			t.Fatalf("campaigns = %#v, want [alpha]", item.Campaigns)
		}
	})

	t.Run("exclude", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "quizzacious", Exclude: alderKeep.Id})
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range result.Items {
			if item.ID == alderKeep.Id {
				t.Fatalf("excluded entity was returned: %#v", item)
			}
		}
		if len(result.Items) != 2 {
			t.Fatalf("exclude items = %#v, want 2", itemNames(result))
		}
	})

	t.Run("limit", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "quizzacious", Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if result.Limit != 1 || len(result.Items) != 1 {
			t.Fatalf("limit = %d, items = %d, want 1 and 1", result.Limit, len(result.Items))
		}
		result, err = Search(app, SearchParams{Query: "quizzacious", Limit: 1000})
		if err != nil {
			t.Fatal(err)
		}
		if result.Limit != 200 {
			t.Fatalf("large limit = %d, want 200", result.Limit)
		}
	})

	t.Run("unknown campaign", func(t *testing.T) {
		if _, err := Search(app, SearchParams{Campaign: "missing"}); err == nil {
			t.Fatal("expected an error for an unknown campaign")
		}
	})

	t.Run("no query sorted by name", func(t *testing.T) {
		result, err := Search(app, SearchParams{})
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"Alder Keep", "Alderwood", "Ancient Thread", "Global Grove"}
		got := itemNames(result)
		if len(got) != len(want) {
			t.Fatalf("names = %#v, want %#v", got, want)
		}
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("names = %#v, want %#v", got, want)
			}
		}
		for _, item := range result.Items {
			if item.Snippet != "" {
				t.Fatalf("item %q has a snippet without a query: %q", item.Name, item.Snippet)
			}
			if item.Campaigns == nil {
				t.Fatalf("item %q has a nil campaigns array", item.Name)
			}
		}
	})

	t.Run("unusable query", func(t *testing.T) {
		result, err := Search(app, SearchParams{Query: "!!! ???"})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Items) != 4 {
			t.Fatalf("unusable query items = %#v, want all 4", itemNames(result))
		}
	})
}
