package catalogimport

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var allowedTypes = map[string]bool{"item": true, "spell": true, "creature": true}

// Document is the explicit, source-neutral interchange format for local catalog imports.
type Document struct {
	Records []InputRecord `json:"records"`
}

type InputRecord struct {
	Type            string          `json:"type"`
	Source          string          `json:"source"`
	SourceID        string          `json:"source_id"`
	Name            string          `json:"name"`
	Level           string          `json:"level,omitempty"`
	School          string          `json:"school,omitempty"`
	CreatureType    string          `json:"creature_type,omitempty"`
	ChallengeRating string          `json:"challenge_rating,omitempty"`
	Original        json.RawMessage `json:"original"`
}

type Summary struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
}

// Parse validates a source-neutral import document without interpreting game-system data.
func Parse(input io.Reader) (Document, error) {
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	var document Document
	if err := decoder.Decode(&document); err != nil {
		return Document{}, fmt.Errorf("decode import document: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return Document{}, errors.New("import document must contain a single JSON value")
		}
		return Document{}, fmt.Errorf("decode trailing data: %w", err)
	}
	if len(document.Records) == 0 {
		return Document{}, errors.New("import document has no records")
	}
	seen := make(map[string]bool, len(document.Records))
	for i, record := range document.Records {
		if !allowedTypes[record.Type] {
			return Document{}, fmt.Errorf("record %d: type must be item, spell, or creature", i+1)
		}
		if strings.TrimSpace(record.Source) == "" || strings.TrimSpace(record.SourceID) == "" || strings.TrimSpace(record.Name) == "" {
			return Document{}, fmt.Errorf("record %d: source, source_id, and name are required", i+1)
		}
		if len(record.Original) == 0 || !json.Valid(record.Original) || bytes.Equal(bytes.TrimSpace(record.Original), []byte("null")) {
			return Document{}, fmt.Errorf("record %d: original must be a non-null JSON value", i+1)
		}
		identity := strings.Join([]string{record.Type, record.Source, record.SourceID}, "\x00")
		if seen[identity] {
			return Document{}, fmt.Errorf("record %d: duplicate type/source/source_id identity", i+1)
		}
		seen[identity] = true
	}
	return document, nil
}

// Import upserts imported fields by stable system/type/source/source_id identity.
// Alternate descriptions and notes are deliberately left untouched on reimport.
func Import(app core.App, systemKey string, document Document) (Summary, error) {
	var summary Summary
	system, err := app.FindFirstRecordByData("systems", "key", systemKey)
	if err != nil {
		return summary, fmt.Errorf("find system %q: %w", systemKey, err)
	}
	collection, err := app.FindCachedCollectionByNameOrId("catalog")
	if err != nil {
		return summary, fmt.Errorf("find catalog collection: %w", err)
	}
	for i, input := range document.Records {
		record, findErr := app.FindFirstRecordByFilter(
			collection,
			"system = {:system} && type = {:type} && source = {:source} && source_id = {:sourceId}",
			dbx.Params{"system": system.Id, "type": input.Type, "source": input.Source, "sourceId": input.SourceID},
		)
		created := false
		if errors.Is(findErr, sql.ErrNoRows) {
			record = core.NewRecord(collection)
			created = true
		} else if findErr != nil {
			return summary, fmt.Errorf("find catalog record %d: %w", i+1, findErr)
		}
		previousAlternate := record.GetString("alternate_description")
		previousNotes := record.GetString("notes")
		var original any
		if err := json.Unmarshal(input.Original, &original); err != nil {
			return summary, fmt.Errorf("decode original JSON for record %d: %w", i+1, err)
		}
		record.Set("system", system.Id)
		record.Set("type", input.Type)
		record.Set("source", input.Source)
		record.Set("source_id", input.SourceID)
		record.Set("name", input.Name)
		record.Set("level", input.Level)
		record.Set("school", input.School)
		record.Set("creature_type", input.CreatureType)
		record.Set("challenge_rating", input.ChallengeRating)
		record.Set("original_json", original)
		record.Set("alternate_description", previousAlternate)
		record.Set("notes", previousNotes)
		if err := app.Save(record); err != nil {
			return summary, fmt.Errorf("save catalog record %d: %w", i+1, err)
		}
		if created {
			summary.Created++
		} else {
			summary.Updated++
		}
	}
	return summary, nil
}
