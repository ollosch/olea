package dnd5eimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"olea/catalogimport"
)

// Result contains normalized catalog records and explicit reasons for omitted input.
type Result struct {
	Document catalogimport.Document
	Skipped  int
	Warnings []string
}

var spellSchools = map[string]string{
	"A": "Abjuration",
	"C": "Conjuration",
	"D": "Divination",
	"E": "Enchantment",
	"V": "Evocation",
	"I": "Illusion",
	"N": "Necromancy",
	"T": "Transmutation",
}

// ParseSpells reads a 5etools-style spell document without discarding source fields.
func ParseSpells(input io.Reader) (Result, error) {
	var root map[string]json.RawMessage
	decoder := json.NewDecoder(input)
	if err := decoder.Decode(&root); err != nil {
		return Result{}, fmt.Errorf("decode spells document: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return Result{}, fmt.Errorf("spells document must contain one JSON value")
		}
		return Result{}, fmt.Errorf("decode trailing data: %w", err)
	}
	rawSpells, ok := root["spell"]
	if !ok {
		return Result{}, fmt.Errorf("spells document has no spell array")
	}
	var spells []json.RawMessage
	if err := json.Unmarshal(rawSpells, &spells); err != nil {
		return Result{}, fmt.Errorf("decode spell array: %w", err)
	}
	if len(spells) == 0 {
		return Result{}, fmt.Errorf("spells document has no spell records")
	}

	result := Result{}
	for i, raw := range spells {
		var spell struct {
			Name   string `json:"name"`
			Source string `json:"source"`
			Level  *int   `json:"level"`
			School string `json:"school"`
		}
		if err := json.Unmarshal(raw, &spell); err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("spell %d: invalid record: %v", i+1, err))
			continue
		}
		if strings.TrimSpace(spell.Name) == "" || strings.TrimSpace(spell.Source) == "" || spell.Level == nil || spell.School == "" {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("spell %d: missing name, source, level, or school", i+1))
			continue
		}
		school := strings.ToUpper(spell.School)
		if normalized, known := spellSchools[school]; known {
			school = normalized
		} else {
			result.Warnings = append(result.Warnings, fmt.Sprintf("spell %q (%s): unknown school code %q retained", spell.Name, spell.Source, spell.School))
		}
		result.Document.Records = append(result.Document.Records, catalogimport.InputRecord{
			Type: "spell", Source: spell.Source, SourceID: spell.Name, Name: spell.Name,
			Level: fmt.Sprintf("%d", *spell.Level), School: school,
			Original: bytes.TrimSpace(raw),
		})
	}
	if len(result.Document.Records) == 0 {
		return result, fmt.Errorf("no valid spell records to import")
	}
	return result, nil
}
