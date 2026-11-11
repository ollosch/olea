package world

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var (
	fencedCodeFencePattern = regexp.MustCompile("(?m)^\\s*```[^\\n]*$")
	htmlTagPattern         = regexp.MustCompile(`<[^>]+>`)
	markdownImagePattern   = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	markdownLinkPattern    = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	imageEmbedPattern      = regexp.MustCompile(`!\[\[[^\]]*\]\]`)
	ftsWikilinkPattern     = regexp.MustCompile(`\[\[([^\]|]*)(?:\|([^\]]*))?\]\]`)
	headingPattern         = regexp.MustCompile(`(?m)^[ \t]*#{1,6}[ \t]*`)
	quotePattern           = regexp.MustCompile(`(?m)^[ \t]*(?:>[ \t]*)+`)
	listPattern            = regexp.MustCompile(`(?m)^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?`)
	tableSeparatorPattern  = regexp.MustCompile(`(?m)^[ \t]*\|?[ \t:|-]+\|?[ \t]*$`)
	emphasisPattern        = regexp.MustCompile(`\*\*|__|~~|\*|_`)
)

// PlainText strips markdown syntax and returns readable text for indexing.
func PlainText(markdown string) string {
	text := strings.ReplaceAll(markdown, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = fencedCodeFencePattern.ReplaceAllString(text, "")
	text = markdownImagePattern.ReplaceAllString(text, "$1")
	text = markdownLinkPattern.ReplaceAllString(text, "$1")
	text = imageEmbedPattern.ReplaceAllString(text, "")
	text = ftsWikilinkPattern.ReplaceAllStringFunc(text, func(match string) string {
		parts := ftsWikilinkPattern.FindStringSubmatch(match)
		if parts == nil {
			return match
		}
		if strings.TrimSpace(parts[2]) != "" {
			return parts[2]
		}
		return parts[1]
	})
	text = htmlTagPattern.ReplaceAllString(text, " ")
	text = headingPattern.ReplaceAllString(text, "")
	text = quotePattern.ReplaceAllString(text, "")
	text = listPattern.ReplaceAllString(text, "")
	text = tableSeparatorPattern.ReplaceAllString(text, " ")
	text = strings.ReplaceAll(text, "|", " ")
	text = strings.ReplaceAll(text, "`", "")
	text = emphasisPattern.ReplaceAllString(text, "")
	return strings.Join(strings.Fields(text), " ")
}

// RebuildFTS rebuilds the entity full-text search index from all entities.
func RebuildFTS(app core.App) (rows int, err error) {
	if _, err := app.DB().NewQuery("DELETE FROM entity_fts").Execute(); err != nil {
		return 0, err
	}
	records, err := app.FindRecordsByFilter("entities", "", "id", 0, 0)
	if err != nil {
		return 0, err
	}
	for _, record := range records {
		if err := insertFTS(app, record); err != nil {
			return rows, err
		}
		rows++
	}
	return rows, nil
}

// RefreshEntityFTS replaces a single entity's full-text search row.
func RefreshEntityFTS(app core.App, record *core.Record) error {
	if record == nil {
		return fmt.Errorf("refresh entity fts: record is nil")
	}
	if err := DeleteEntityFTS(app, record.Id); err != nil {
		return err
	}
	return insertFTS(app, record)
}

// DeleteEntityFTS removes a single entity's full-text search row.
func DeleteEntityFTS(app core.App, id string) error {
	if strings.TrimSpace(id) == "" {
		return nil
	}
	_, err := app.DB().NewQuery("DELETE FROM entity_fts WHERE entity_id = {:id}").Bind(dbx.Params{"id": id}).Execute()
	return err
}

func insertFTS(app core.App, record *core.Record) error {
	_, err := app.DB().NewQuery(`INSERT INTO entity_fts (entity_id, name, body, type_class, template, folder)
		VALUES ({:entity_id}, {:name}, {:body}, {:type_class}, {:template}, {:folder})`).Bind(dbx.Params{
		"entity_id":  record.Id,
		"name":       record.GetString("name"),
		"body":       PlainText(record.GetString("body")),
		"type_class": record.GetString("type_class"),
		"template":   record.GetString("template"),
		"folder":     record.GetString("folder"),
	}).Execute()
	return err
}
