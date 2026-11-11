package world

import (
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func pathDepth(t *testing.T, app core.App, ancestorID, descendantID string) (int, bool) {
	t.Helper()
	var depth int
	err := app.DB().NewQuery("SELECT depth FROM entity_paths WHERE ancestor_id = {:ancestor} AND descendant_id = {:descendant}").
		Bind(dbx.Params{"ancestor": ancestorID, "descendant": descendantID}).Row(&depth)
	if err != nil {
		return 0, false
	}
	return depth, true
}

func relationCount(t *testing.T, app core.App, fromID string) int {
	t.Helper()
	var count int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM relations WHERE `from` = {:from}").
		Bind(dbx.Params{"from": fromID}).Row(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func ftsCount(t *testing.T, app core.App, entityID string) int {
	t.Helper()
	var count int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM entity_fts WHERE entity_id = {:id}").
		Bind(dbx.Params{"id": entityID}).Row(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestEntityAndRelationHooks(t *testing.T) {
	app := newWorldTestApp(t)
	RegisterHooks(app)

	parent := createEntity(t, app, map[string]any{
		"name":       "Parent",
		"type_class": "location",
		"body":       "Parent body",
	})
	child := createEntity(t, app, map[string]any{
		"name":       "Child",
		"type_class": "actor",
		"body":       "An initial child passage.",
		"links":      map[string]any{"In": "Parent"},
	})

	if got := relationCount(t, app, child.Id); got != 1 {
		t.Fatalf("child relations = %d, want 1", got)
	}
	if depth, ok := pathDepth(t, app, child.Id, child.Id); !ok || depth != 0 {
		t.Fatalf("self path = %d, %v, want depth 0", depth, ok)
	}
	if depth, ok := pathDepth(t, app, parent.Id, child.Id); !ok || depth != 1 {
		t.Fatalf("parent path = %d, %v, want depth 1", depth, ok)
	}
	if got := ftsCount(t, app, child.Id); got != 1 {
		t.Fatalf("child fts rows = %d, want 1", got)
	}

	child.Set("links", map[string]any{})
	child.Set("body", "A freshly revised passage about wyverns.")
	if err := app.Save(child); err != nil {
		t.Fatal(err)
	}

	if got := relationCount(t, app, child.Id); got != 0 {
		t.Fatalf("child relations after update = %d, want 0", got)
	}
	if _, ok := pathDepth(t, app, parent.Id, child.Id); ok {
		t.Fatal("parent path still exists after removing the link")
	}
	if got := ftsCount(t, app, child.Id); got != 1 {
		t.Fatalf("child fts rows after update = %d, want 1", got)
	}
	result, err := Search(app, SearchParams{Query: "wyverns"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].ID != child.Id {
		t.Fatalf("fts search after update = %#v", result.Items)
	}

	if err := app.Delete(child); err != nil {
		t.Fatal(err)
	}
	if got := ftsCount(t, app, child.Id); got != 0 {
		t.Fatalf("child fts rows after delete = %d, want 0", got)
	}
	var paths int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM entity_paths WHERE descendant_id = {:id}").
		Bind(dbx.Params{"id": child.Id}).Row(&paths); err != nil {
		t.Fatal(err)
	}
	if paths != 0 {
		t.Fatalf("child paths after delete = %d, want 0", paths)
	}

	parentTwo := createEntity(t, app, map[string]any{"name": "Parent Two", "type_class": "group"})
	childTwo := createEntity(t, app, map[string]any{"name": "Child Two", "type_class": "actor"})
	relationType, err := app.FindFirstRecordByData("relation_types", "key", "In")
	if err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCachedCollectionByNameOrId("relations")
	if err != nil {
		t.Fatal(err)
	}
	relation := core.NewRecord(collection)
	relation.Set("from", childTwo.Id)
	relation.Set("to", parentTwo.Id)
	relation.Set("type", relationType.Id)
	if err := app.Save(relation); err != nil {
		t.Fatal(err)
	}
	if depth, ok := pathDepth(t, app, parentTwo.Id, childTwo.Id); !ok || depth != 1 {
		t.Fatalf("manual relation path = %d, %v, want depth 1", depth, ok)
	}

	if err := app.Delete(relation); err != nil {
		t.Fatal(err)
	}
	if _, ok := pathDepth(t, app, parentTwo.Id, childTwo.Id); ok {
		t.Fatal("path still exists after deleting the manual relation")
	}

	updated := createEntity(t, app, map[string]any{"name": "Completes", "type_class": "note"})
	updated.Set("body", "A save that proves the hooks terminate.")
	if err := app.Save(updated); err != nil {
		t.Fatalf("save did not terminate cleanly: %v", err)
	}
}
