package world

import (
	"sort"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func snapshotRecordByName(t *testing.T, records []map[string]any, name string) map[string]any {
	t.Helper()
	for _, record := range records {
		if record["name"] == name {
			return record
		}
	}
	t.Fatalf("record %q not found", name)
	return nil
}

func snapshotRecordByID(t *testing.T, records []map[string]any, id string) map[string]any {
	t.Helper()
	for _, record := range records {
		if record["id"] == id {
			return record
		}
	}
	t.Fatalf("record %q not found", id)
	return nil
}

func TestSnapshot(t *testing.T) {
	app := newWorldTestApp(t)

	alpha := createCampaign(t, app, "alpha", "Alpha")
	beta := createCampaign(t, app, "beta", "Beta")

	parent := createEntity(t, app, map[string]any{
		"name":       "Parent Place",
		"type_class": "location",
		"body":       "A parent location.",
	})
	keep := createEntity(t, app, map[string]any{
		"name":       "Alder Keep",
		"type_class": "location",
		"template":   "settlement",
		"body":       "# Keep\n\nA fortified keep on the northern road.",
		"data":       map[string]any{"Population": "1200", "Region": "North"},
		"links":      map[string]any{"In": "Parent Place"},
		"meta":       map[string]any{"source": "vault"},
		"aliases":    []string{"The Keep", "Alderk"},
		"campaigns":  []string{alpha.Id, beta.Id},
	})

	relationType, err := app.FindFirstRecordByData("relation_types", "key", "In")
	if err != nil {
		t.Fatal(err)
	}
	relationCollection, err := app.FindCachedCollectionByNameOrId("relations")
	if err != nil {
		t.Fatal(err)
	}
	relation := core.NewRecord(relationCollection)
	relation.Set("from", keep.Id)
	relation.Set("to", parent.Id)
	relation.Set("type", relationType.Id)
	relation.Set("note", "inside the parent place")
	if err := app.Save(relation); err != nil {
		t.Fatal(err)
	}

	mentionCollection, err := app.FindCachedCollectionByNameOrId("mentions")
	if err != nil {
		t.Fatal(err)
	}
	mention := core.NewRecord(mentionCollection)
	mention.Set("source", keep.Id)
	mention.Set("target", parent.Id)
	mention.Set("target_name", "Parent Place")
	if err := app.Save(mention); err != nil {
		t.Fatal(err)
	}

	mapCollection, err := app.FindCachedCollectionByNameOrId("maps")
	if err != nil {
		t.Fatal(err)
	}
	worldMap := core.NewRecord(mapCollection)
	worldMap.Set("name", "World Map")
	worldMap.Set("campaign", alpha.Id)
	worldMap.Set("image", "/olea/assets/world-map.png")
	worldMap.Set("config", map[string]any{"zoom": 3, "unit": "miles"})
	if err := app.Save(worldMap); err != nil {
		t.Fatal(err)
	}

	markerCollection, err := app.FindCachedCollectionByNameOrId("map_markers")
	if err != nil {
		t.Fatal(err)
	}
	marker := core.NewRecord(markerCollection)
	marker.Set("map", worldMap.Id)
	marker.Set("entity", keep.Id)
	marker.Set("x", 10.5)
	marker.Set("y", 20.5)
	marker.Set("label", "Alder Keep")
	if err := app.Save(marker); err != nil {
		t.Fatal(err)
	}

	snapshot, err := Snapshot(app)
	if err != nil {
		t.Fatal(err)
	}

	if snapshot.Campaigns == nil || snapshot.Entities == nil || snapshot.RelationTypes == nil ||
		snapshot.Relations == nil || snapshot.Mentions == nil || snapshot.Maps == nil || snapshot.MapMarkers == nil {
		t.Fatal("snapshot contains a nil slice")
	}
	if len(snapshot.Campaigns) != 2 || len(snapshot.Entities) != 2 || len(snapshot.Relations) != 1 ||
		len(snapshot.Mentions) != 1 || len(snapshot.Maps) != 1 || len(snapshot.MapMarkers) != 1 {
		t.Fatalf("unexpected snapshot sizes: campaigns=%d entities=%d relations=%d mentions=%d maps=%d markers=%d",
			len(snapshot.Campaigns), len(snapshot.Entities), len(snapshot.Relations),
			len(snapshot.Mentions), len(snapshot.Maps), len(snapshot.MapMarkers))
	}
	if snapshot.Campaigns[0]["name"] != "Alpha" || snapshot.Campaigns[1]["name"] != "Beta" {
		t.Fatalf("campaigns not sorted by name: %#v", snapshot.Campaigns)
	}
	if snapshot.Entities[0]["name"] != "Alder Keep" || snapshot.Entities[1]["name"] != "Parent Place" {
		t.Fatalf("entities not sorted by name: %#v", snapshot.Entities)
	}

	entity := snapshotRecordByName(t, snapshot.Entities, "Alder Keep")
	if entity["body"] != "# Keep\n\nA fortified keep on the northern road." {
		t.Fatalf("entity body = %#v", entity["body"])
	}
	var data map[string]any
	if err := DecodeJSON(entity["data"], &data); err != nil {
		t.Fatal(err)
	}
	if data["Population"] != "1200" || data["Region"] != "North" {
		t.Fatalf("entity data = %#v", data)
	}
	var links map[string]any
	if err := DecodeJSON(entity["links"], &links); err != nil {
		t.Fatal(err)
	}
	if links["In"] != "Parent Place" {
		t.Fatalf("entity links = %#v", links)
	}
	var meta map[string]any
	if err := DecodeJSON(entity["meta"], &meta); err != nil {
		t.Fatal(err)
	}
	if meta["source"] != "vault" {
		t.Fatalf("entity meta = %#v", meta)
	}
	var aliases []string
	if err := DecodeJSON(entity["aliases"], &aliases); err != nil {
		t.Fatal(err)
	}
	sort.Strings(aliases)
	if len(aliases) != 2 || aliases[0] != "Alderk" || aliases[1] != "The Keep" {
		t.Fatalf("entity aliases = %#v", aliases)
	}
	var campaignIDs []string
	if err := DecodeJSON(entity["campaigns"], &campaignIDs); err != nil {
		t.Fatal(err)
	}
	sort.Strings(campaignIDs)
	wantCampaigns := []string{alpha.Id, beta.Id}
	sort.Strings(wantCampaigns)
	if len(campaignIDs) != 2 || campaignIDs[0] != wantCampaigns[0] || campaignIDs[1] != wantCampaigns[1] {
		t.Fatalf("entity campaigns = %#v, want %#v", campaignIDs, wantCampaigns)
	}

	relationRecord := snapshotRecordByID(t, snapshot.Relations, relation.Id)
	if relationRecord["from"] != keep.Id || relationRecord["to"] != parent.Id || relationRecord["type"] != relationType.Id {
		t.Fatalf("relation = %#v", relationRecord)
	}

	mentionRecord := snapshotRecordByID(t, snapshot.Mentions, mention.Id)
	if mentionRecord["source"] != keep.Id || mentionRecord["target"] != parent.Id || mentionRecord["target_name"] != "Parent Place" {
		t.Fatalf("mention = %#v", mentionRecord)
	}

	mapRecord := snapshotRecordByID(t, snapshot.Maps, worldMap.Id)
	if mapRecord["name"] != "World Map" || mapRecord["campaign"] != alpha.Id || mapRecord["image"] != "/olea/assets/world-map.png" {
		t.Fatalf("map = %#v", mapRecord)
	}
	var config map[string]any
	if err := DecodeJSON(mapRecord["config"], &config); err != nil {
		t.Fatal(err)
	}
	if config["unit"] != "miles" {
		t.Fatalf("map config = %#v", config)
	}

	markerRecord := snapshotRecordByID(t, snapshot.MapMarkers, marker.Id)
	if markerRecord["map"] != worldMap.Id || markerRecord["entity"] != keep.Id || markerRecord["label"] != "Alder Keep" {
		t.Fatalf("map marker = %#v", markerRecord)
	}

	if snapshot.Revision == "" {
		t.Fatal("snapshot revision is empty")
	}
	firstRevision := snapshot.Revision

	time.Sleep(10 * time.Millisecond)
	keep.Set("body", "# Keep\n\nA freshly revised keep.")
	if err := app.Save(keep); err != nil {
		t.Fatal(err)
	}

	updated, err := Snapshot(app)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision == "" || updated.Revision == firstRevision {
		t.Fatalf("revision did not change after an entity update: %q -> %q", firstRevision, updated.Revision)
	}
}
