package vaultimport

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	_ "olea/migrations"
	"olea/world"
)

func newImportTestApp(t *testing.T) *pocketbase.PocketBase {
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

func writeVaultFixture(t *testing.T, root, relativePath, content string) {
	t.Helper()
	fullPath := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeFixtureVault(t *testing.T, root string) {
	t.Helper()
	writeVaultFixture(t, root, "Campaigns/Almost Titans/Notes/Folder Note.md", "---\ntype: note\n---\nFolder body\n")
	writeVaultFixture(t, root, "Campaigns/Almost Titans/Notes/Frontmatter Note.md", "---\ncampaigns:\n  - Fate's Children\n---\nFrontmatter body\n")
	writeVaultFixture(t, root, "Campaigns/Almost Titans/Notes/Map Note.md", "```leaflet\nid: test-map\nimage: [[map.png]]\nlat: 50\nlong: 50\ndefaultZoom: 7\nunit: kilometers\n```\n\nAfter map\n")
	writeVaultFixture(t, root, "Files/Images/sword.png", "fake-png-bytes-sword")
	writeVaultFixture(t, root, "Files/Maps/map.png", "fake-png-bytes-map")
	writeVaultFixture(t, root, "World/Locations/Village.md", "---\ntype: location\n---\n# Village\n\nA quizzacious place.\n\n![[sword.png|A shiny sword]]\n[[sword.png|Plain Sword]]\n![[missing.png]]\n")
	writeVaultFixture(t, root, "World/Locations/Grandparent.md", "---\ntype: location\n---\nGrandparent body\n")
	writeVaultFixture(t, root, "World/Actors/Parent.md", "---\ntype: actor\nlinks:\n  In: Grandparent\n---\nParent body\n")
	writeVaultFixture(t, root, "World/Actors/Child.md", "---\ntype: actor\nlinks:\n  In: Parent\n---\nChild body\n")
	writeVaultFixture(t, root, "Timeline/Events/Old Event.md", "---\ntype: event\n---\nOld event\n")
	writeVaultFixture(t, root, "World/Locations/Broken.md", "---\nkey: [\n---\nBroken body\n")
}

func TestImportCompletesAndIsIdempotent(t *testing.T) {
	app := newImportTestApp(t)
	root := t.TempDir()
	writeFixtureVault(t, root)

	report, err := Import(app, root)
	if err != nil {
		t.Fatal(err)
	}

	if report.TimelineSkipped != 1 {
		t.Fatalf("TimelineSkipped = %d, want 1", report.TimelineSkipped)
	}
	if _, err := app.FindFirstRecordByData("entities", "source_path", "Timeline/Events/Old Event.md"); err == nil {
		t.Fatal("Timeline note was imported")
	}

	almostTitans, err := app.FindFirstRecordByData("campaigns", "key", "almost-titans")
	if err != nil {
		t.Fatal(err)
	}
	fatesChildren, err := app.FindFirstRecordByData("campaigns", "key", "fates-children")
	if err != nil {
		t.Fatal(err)
	}
	folderNote, err := app.FindFirstRecordByData("entities", "source_path", "Campaigns/Almost Titans/Notes/Folder Note.md")
	if err != nil {
		t.Fatal(err)
	}
	if ids := folderNote.GetStringSlice("campaigns"); len(ids) != 1 || ids[0] != almostTitans.Id {
		t.Fatalf("folder campaign = %#v, want %q", ids, almostTitans.Id)
	}
	frontmatterNote, err := app.FindFirstRecordByData("entities", "source_path", "Campaigns/Almost Titans/Notes/Frontmatter Note.md")
	if err != nil {
		t.Fatal(err)
	}
	if ids := frontmatterNote.GetStringSlice("campaigns"); len(ids) != 1 || ids[0] != fatesChildren.Id {
		t.Fatalf("frontmatter campaign = %#v, want %q", ids, fatesChildren.Id)
	}

	village, err := app.FindFirstRecordByData("entities", "source_path", "World/Locations/Village.md")
	if err != nil {
		t.Fatal(err)
	}
	body := village.GetString("body")
	if !strings.Contains(body, "![A shiny sword](/olea/assets/") {
		t.Fatalf("body missing rewritten image embed: %q", body)
	}
	if !strings.Contains(body, "[Plain Sword](/olea/assets/") {
		t.Fatalf("body missing rewritten image link: %q", body)
	}
	if !strings.Contains(body, "![[missing.png]]") {
		t.Fatalf("missing image was rewritten: %q", body)
	}
	if !containsString(report.MissingAssets, "World/Locations/Village.md: missing.png") {
		t.Fatalf("missing assets = %#v", report.MissingAssets)
	}
	assetName := firstAssetName(t, body)
	if assetName == "" {
		t.Fatal("could not parse rewritten asset URL")
	}
	if _, err := os.Stat(filepath.Join(world.AssetsDir(app.DataDir()), assetName)); err != nil {
		t.Fatalf("copied asset %q is missing: %v", assetName, err)
	}
	assetNames := assetFilenames(t, app)
	if !hasSuffix(assetNames, "-sword.png") {
		t.Fatalf("asset files = %#v, missing sword copy", assetNames)
	}

	mapRecord, err := app.FindFirstRecordByData("maps", "name", "Map Note")
	if err != nil {
		t.Fatal(err)
	}
	if mapRecord.GetString("campaign") != almostTitans.Id {
		t.Fatalf("map campaign = %q, want %q", mapRecord.GetString("campaign"), almostTitans.Id)
	}
	if !strings.HasPrefix(mapRecord.GetString("image"), world.AssetsURLPrefix) {
		t.Fatalf("map image = %q", mapRecord.GetString("image"))
	}
	var config map[string]any
	if err := world.DecodeJSON(mapRecord.Get("config"), &config); err != nil {
		t.Fatal(err)
	}
	if config["id"] != "test-map" || config["unit"] != "kilometers" || config["defaultZoom"] != float64(7) {
		t.Fatalf("map config = %#v", config)
	}
	if _, hasImage := config["image"]; hasImage {
		t.Fatalf("map config still contains image: %#v", config)
	}
	mapNote, err := app.FindFirstRecordByData("entities", "source_path", "Campaigns/Almost Titans/Notes/Map Note.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(mapNote.GetString("body"), ":::map{mapId="+mapRecord.Id+"}") {
		t.Fatalf("map placeholder missing from body: %q", mapNote.GetString("body"))
	}

	child, err := app.FindFirstRecordByData("entities", "source_path", "World/Actors/Child.md")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := app.FindFirstRecordByData("entities", "source_path", "World/Actors/Parent.md")
	if err != nil {
		t.Fatal(err)
	}
	grandparent, err := app.FindFirstRecordByData("entities", "source_path", "World/Locations/Grandparent.md")
	if err != nil {
		t.Fatal(err)
	}
	var pathRows []struct {
		AncestorID   string `db:"ancestor_id"`
		DescendantID string `db:"descendant_id"`
		Depth        int    `db:"depth"`
	}
	if err := app.DB().NewQuery("SELECT ancestor_id, descendant_id, depth FROM entity_paths WHERE descendant_id = {:id} ORDER BY depth").
		Bind(dbx.Params{"id": child.Id}).All(&pathRows); err != nil {
		t.Fatal(err)
	}
	depths := map[string]int{}
	for _, row := range pathRows {
		depths[row.AncestorID] = row.Depth
	}
	for _, expected := range []struct {
		id    string
		depth int
	}{
		{child.Id, 0},
		{parent.Id, 1},
		{grandparent.Id, 2},
	} {
		if depths[expected.id] != expected.depth {
			t.Fatalf("paths for child = %#v, want %q at depth %d", depths, expected.id, expected.depth)
		}
	}
	if len(pathRows) != 3 {
		t.Fatalf("path rows for child = %#v", pathRows)
	}

	var ftsIDs []string
	if err := app.DB().NewQuery("SELECT entity_id FROM entity_fts WHERE entity_fts MATCH {:term}").
		Bind(dbx.Params{"term": "quizzacious"}).Column(&ftsIDs); err != nil {
		t.Fatal(err)
	}
	if len(ftsIDs) != 1 || ftsIDs[0] != village.Id {
		t.Fatalf("fts match = %#v, want %q", ftsIDs, village.Id)
	}

	broken, err := app.FindFirstRecordByData("entities", "source_path", "World/Locations/Broken.md")
	if err != nil {
		t.Fatal(err)
	}
	if broken.GetString("type_class") != "location" {
		t.Fatalf("broken note type_class = %q", broken.GetString("type_class"))
	}
	if !containsSubstring(report.Warnings, "Broken.md") {
		t.Fatalf("warnings = %#v, missing malformed frontmatter warning", report.Warnings)
	}

	entityCount := countRecords(t, app, "entities")
	relationCount := countRecords(t, app, "relations")
	mentionCount := countRecords(t, app, "mentions")
	mapCount := countRecords(t, app, "maps")
	assetsBefore := assetFilenames(t, app)

	second, err := Import(app, root)
	if err != nil {
		t.Fatal(err)
	}
	if second.AssetsCopied != 0 {
		t.Fatalf("second import copied %d assets, want 0", second.AssetsCopied)
	}
	if got := countRecords(t, app, "entities"); got != entityCount {
		t.Fatalf("entity count changed from %d to %d", entityCount, got)
	}
	if got := countRecords(t, app, "relations"); got != relationCount {
		t.Fatalf("relation count changed from %d to %d", relationCount, got)
	}
	if got := countRecords(t, app, "mentions"); got != mentionCount {
		t.Fatalf("mention count changed from %d to %d", mentionCount, got)
	}
	if got := countRecords(t, app, "maps"); got != mapCount {
		t.Fatalf("map count changed from %d to %d", mapCount, got)
	}
	assetsAfter := assetFilenames(t, app)
	if strings.Join(assetsBefore, "\x00") != strings.Join(assetsAfter, "\x00") {
		t.Fatalf("asset files changed from %#v to %#v", assetsBefore, assetsAfter)
	}
}

func countRecords(t *testing.T, app core.App, collection string) int {
	t.Helper()
	records, err := app.FindRecordsByFilter(collection, "", "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	return len(records)
}

func assetFilenames(t *testing.T, app core.App) []string {
	t.Helper()
	entries, err := os.ReadDir(world.AssetsDir(app.DataDir()))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names
}

func firstAssetName(t *testing.T, body string) string {
	t.Helper()
	index := strings.Index(body, world.AssetsURLPrefix)
	if index < 0 {
		return ""
	}
	rest := body[index+len(world.AssetsURLPrefix):]
	end := strings.Index(rest, ")")
	if end < 0 {
		return ""
	}
	return rest[:end]
}

func hasSuffix(values []string, suffix string) bool {
	for _, value := range values {
		if strings.HasSuffix(value, suffix) {
			return true
		}
	}
	return false
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func containsSubstring(values []string, expected string) bool {
	for _, value := range values {
		if strings.Contains(value, expected) {
			return true
		}
	}
	return false
}
