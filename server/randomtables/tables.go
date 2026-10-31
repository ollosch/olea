package randomtables

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type Entry struct {
	Min  int    `json:"min"`
	Max  int    `json:"max"`
	Text string `json:"text"`
	Type string `json:"type,omitempty"`
	Ref  string `json:"ref,omitempty"`
}

func (entry *Entry) UnmarshalJSON(data []byte) error {
	var value struct {
		Min  *int   `json:"min"`
		Max  *int   `json:"max"`
		Text string `json:"text"`
		Type string `json:"type"`
		Ref  string `json:"ref"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.Min == nil || value.Max == nil {
		return errors.New("Both range endpoints are required.")
	}
	*entry = Entry{Min: *value.Min, Max: *value.Max, Text: value.Text, Type: value.Type, Ref: value.Ref}
	return nil
}

type Table struct {
	Name    string  `json:"name"`
	Dice    string  `json:"dice"`
	Entries []Entry `json:"entries"`
}
type Template struct {
	Source   string          `json:"source"`
	SourceID string          `json:"source_id"`
	Name     string          `json:"name"`
	Dice     string          `json:"dice"`
	Entries  []TemplateEntry `json:"entries"`
}
type TemplateEntry struct {
	Min      int    `json:"min"`
	Max      int    `json:"max"`
	Text     string `json:"text"`
	Type     string `json:"type,omitempty"`
	Source   string `json:"source,omitempty"`
	SourceID string `json:"source_id,omitempty"`
}

func (entry *TemplateEntry) UnmarshalJSON(data []byte) error {
	var value struct {
		Min      *int   `json:"min"`
		Max      *int   `json:"max"`
		Text     string `json:"text"`
		Type     string `json:"type"`
		Source   string `json:"source"`
		SourceID string `json:"source_id"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.Min == nil || value.Max == nil {
		return errors.New("Both range endpoints are required.")
	}
	*entry = TemplateEntry{Min: *value.Min, Max: *value.Max, Text: value.Text, Type: value.Type, Source: value.Source, SourceID: value.SourceID}
	return nil
}

type Document struct {
	Templates []Template `json:"templates"`
}

var dicePattern = regexp.MustCompile(`(?i)^\s*(\d{1,3})\s*d\s*(\d{1,4})\s*([+-]\s*\d{1,6})?\s*$`)

func Validate(t Table) error {
	if strings.TrimSpace(t.Name) == "" || len(t.Name) > 160 {
		return errors.New("Enter a table name of at most 160 characters.")
	}
	if strings.TrimSpace(t.Dice) != "" {
		m := dicePattern.FindStringSubmatch(t.Dice)
		if m == nil {
			return errors.New("Use NdM with an optional signed constant, such as 2d8+3.")
		}
		count, _ := strconv.Atoi(m[1])
		sides, _ := strconv.Atoi(m[2])
		constant, _ := strconv.Atoi(strings.Join(strings.Fields(m[3]), ""))
		if count < 1 || count > 100 || sides < 1 || sides > 1000 || abs(constant) > 100000 || count*sides+abs(constant) > 100000 {
			return errors.New("Dice expression exceeds supported limits.")
		}
	}
	if len(t.Entries) == 0 || len(t.Entries) > 1000 {
		return errors.New("A table needs between 1 and 1000 entries.")
	}
	entries := append([]Entry(nil), t.Entries...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Min < entries[j].Min })
	for i, entry := range entries {
		if entry.Min < -100000 || entry.Max > 100000 || entry.Min > entry.Max {
			return fmt.Errorf("Entry %d has an invalid or empty range (use whole numbers from -100000 to 100000).", i+1)
		}
		if i > 0 && entry.Min <= entries[i-1].Max {
			return errors.New("Entry ranges overlap.")
		}
		if len(entry.Text) > 10000 || (strings.TrimSpace(entry.Text) == "" && entry.Ref == "") {
			return fmt.Errorf("Entry %d needs text or a reference.", i+1)
		}
		if entry.Type == "" {
			if entry.Ref != "" {
				return errors.New("Reference type is required.")
			}
			continue
		}
		if entry.Type != "item" && entry.Type != "spell" && entry.Type != "creature" && entry.Type != "encounter" {
			return errors.New("Invalid reference type.")
		}
		if entry.Ref == "" {
			return errors.New("Choose a reference or clear its type.")
		}
	}
	return nil
}
func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func validateReferences(app core.App, game *core.Record, entries []Entry) error {
	for _, entry := range entries {
		if entry.Type == "" {
			continue
		}
		collection := "catalog"
		if entry.Type == "encounter" {
			collection = "encounters"
		}
		record, err := app.FindRecordById(collection, entry.Ref)
		if err != nil {
			return fmt.Errorf("Referenced %s is missing.", entry.Type)
		}
		if entry.Type == "encounter" {
			if record.GetString("game") != game.Id {
				return errors.New("Encounter must belong to this game.")
			}
		} else if record.GetString("system") != game.GetString("system") || record.GetString("type") != entry.Type {
			return errors.New("Catalog reference must match this game's system and the selected type.")
		}
	}
	return nil
}

func Save(app core.App, gameID, id string, table Table) (string, error) {
	if err := Validate(table); err != nil {
		return "", err
	}
	var result string
	err := app.RunInTransaction(func(tx core.App) error {
		game, err := tx.FindRecordById("games", gameID)
		if err != nil {
			return errors.New("Game not found.")
		}
		if err := validateReferences(tx, game, table.Entries); err != nil {
			return err
		}
		var record *core.Record
		if id == "" {
			c, err := tx.FindCollectionByNameOrId("random_tables")
			if err != nil {
				return err
			}
			record = core.NewRecord(c)
		} else {
			record, err = tx.FindRecordById("random_tables", id)
			if err != nil || record.GetString("game") != gameID {
				return errors.New("Table not found in this game.")
			}
		}
		record.Set("game", gameID)
		record.Set("name", strings.TrimSpace(table.Name))
		record.Set("dice", strings.TrimSpace(table.Dice))
		record.Set("entries", table.Entries)
		if err := tx.Save(record); err != nil {
			return err
		}
		result = record.Id
		return nil
	})
	return result, err
}

func Copy(app core.App, gameID, templateID string) (string, error) {
	template, err := app.FindRecordById("table_templates", templateID)
	if err != nil {
		return "", errors.New("Template not found.")
	}
	game, err := app.FindRecordById("games", gameID)
	if err != nil || game.GetString("system") != template.GetString("system") {
		return "", errors.New("Template must match this game's system.")
	}
	var entries []Entry
	if err := json.Unmarshal([]byte(template.GetString("entries")), &entries); err != nil {
		return "", err
	}
	return Save(app, gameID, "", Table{Name: template.GetString("name"), Dice: template.GetString("dice"), Entries: entries})
}

// AddCreature revalidates both ends within the same transaction before creating an encounter entry.
func AddCreature(app core.App, gameID, encounterID, creatureID string) error {
	return app.RunInTransaction(func(tx core.App) error {
		game, err := tx.FindRecordById("games", gameID)
		if err != nil {
			return errors.New("Game not found.")
		}
		encounter, err := tx.FindRecordById("encounters", encounterID)
		if err != nil || encounter.GetString("game") != gameID {
			return errors.New("Encounter must belong to this game.")
		}
		creature, err := tx.FindRecordById("catalog", creatureID)
		if err != nil || creature.GetString("system") != game.GetString("system") || creature.GetString("type") != "creature" {
			return errors.New("Creature must belong to this game's system.")
		}
		collection, err := tx.FindCollectionByNameOrId("encounter_creatures")
		if err != nil {
			return err
		}
		record := core.NewRecord(collection)
		record.Set("encounter", encounter.Id)
		record.Set("creature", creature.Id)
		record.Set("name", creature.GetString("name"))
		record.Set("quantity", 1)
		return tx.Save(record)
	})
}

func Parse(input io.Reader) (Document, error) {
	dec := json.NewDecoder(input)
	dec.DisallowUnknownFields()
	var doc Document
	if err := dec.Decode(&doc); err != nil {
		return doc, err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return doc, errors.New("Expected one JSON document.")
	}
	if len(doc.Templates) == 0 {
		return doc, errors.New("No templates supplied.")
	}
	return doc, nil
}

func Import(app core.App, systemKey string, doc Document) (int, error) {
	count := 0
	err := app.RunInTransaction(func(tx core.App) error {
		system, err := tx.FindFirstRecordByData("systems", "key", systemKey)
		if err != nil {
			return fmt.Errorf("system not found: %w", err)
		}
		collection, err := tx.FindCollectionByNameOrId("table_templates")
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, input := range doc.Templates {
			if strings.TrimSpace(input.Source) == "" || strings.TrimSpace(input.SourceID) == "" {
				return errors.New("Template source and source_id are required.")
			}
			identity := input.Source + "\x00" + input.SourceID
			if seen[identity] {
				return errors.New("Duplicate template identity.")
			}
			seen[identity] = true
			table := Table{Name: input.Name, Dice: input.Dice}
			for _, e := range input.Entries {
				entry := Entry{Min: e.Min, Max: e.Max, Text: e.Text, Type: e.Type}
				if e.Type != "" {
					if e.Type != "item" && e.Type != "spell" && e.Type != "creature" {
						return errors.New("Templates may only reference system catalog entries.")
					}
					ref, err := tx.FindFirstRecordByFilter("catalog", "system = {:system} && type = {:type} && source = {:source} && source_id = {:id}", dbx.Params{"system": system.Id, "type": e.Type, "source": e.Source, "id": e.SourceID})
					if err != nil {
						return fmt.Errorf("template catalog reference not found: %s/%s", e.Source, e.SourceID)
					}
					entry.Ref = ref.Id
				} else if e.Source != "" || e.SourceID != "" {
					return errors.New("Reference type is required.")
				}
				table.Entries = append(table.Entries, entry)
			}
			if err := Validate(table); err != nil {
				return fmt.Errorf("template %s: %w", input.Name, err)
			}
			record, err := tx.FindFirstRecordByFilter(collection, "system = {:system} && source = {:source} && source_id = {:id}", dbx.Params{"system": system.Id, "source": input.Source, "id": input.SourceID})
			if errors.Is(err, sql.ErrNoRows) {
				record = core.NewRecord(collection)
			} else if err != nil {
				return err
			}
			record.Set("system", system.Id)
			record.Set("source", input.Source)
			record.Set("source_id", input.SourceID)
			record.Set("name", strings.TrimSpace(input.Name))
			record.Set("dice", strings.TrimSpace(input.Dice))
			record.Set("entries", table.Entries)
			if err := tx.Save(record); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}
