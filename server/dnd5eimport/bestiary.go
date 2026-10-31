package dnd5eimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"olea/catalogimport"
)

// ParseBestiary reads 5etools-style monster data, retaining complete source JSON.
func ParseBestiary(input io.Reader) (Result, error) {
	monsters, err := readArray(input, "monster", "bestiary")
	if err != nil {
		return Result{}, err
	}
	result := Result{}
	for i, raw := range monsters {
		var monster struct {
			Name   string          `json:"name"`
			Source string          `json:"source"`
			Type   json.RawMessage `json:"type"`
			CR     json.RawMessage `json:"cr"`
			HP     *struct {
				Average *int   `json:"average"`
				Formula string `json:"formula"`
			} `json:"hp"`
			Dexterity *int            `json:"dex"`
			Actions   json.RawMessage `json:"action"`
		}
		if err := json.Unmarshal(raw, &monster); err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %d: invalid record: %v", i+1, err))
			continue
		}
		if strings.TrimSpace(monster.Name) == "" || strings.TrimSpace(monster.Source) == "" {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %d: missing name or source", i+1))
			continue
		}
		creatureType := ""
		if len(monster.Type) > 0 {
			value, err := normalizeCreatureType(monster.Type)
			if err != nil {
				result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: %v; retained only in original JSON", monster.Name, err))
			} else {
				creatureType = value
			}
		} else {
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: missing creature type; retained only in original JSON", monster.Name))
		}
		cr := ""
		if len(monster.CR) > 0 {
			value, err := normalizeCR(monster.CR)
			if err != nil {
				result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: %v; retained only in original JSON", monster.Name, err))
			} else {
				cr = value
			}
		} else {
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: missing challenge rating; retained only in original JSON", monster.Name))
		}
		var hpAverage *int
		hpFormula := ""
		if monster.HP != nil {
			hpAverage = monster.HP.Average
			hpFormula = monster.HP.Formula
		}
		if hpAverage == nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: missing HP average; retained only in original JSON", monster.Name))
		}
		if monster.Dexterity == nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: missing Dexterity; no modifier will be inferred", monster.Name))
		}
		actions := json.RawMessage("[]")
		if len(monster.Actions) > 0 {
			var actionList []json.RawMessage
			if err := json.Unmarshal(monster.Actions, &actionList); err != nil {
				result.Skipped++
				result.Warnings = append(result.Warnings, fmt.Sprintf("monster %q: invalid actions array: %v", monster.Name, err))
				continue
			}
			actions = monster.Actions
		}
		result.Document.Records = append(result.Document.Records, catalogimport.InputRecord{
			Type: "creature", Source: monster.Source, SourceID: monster.Name, Name: monster.Name,
			CreatureType: creatureType, ChallengeRating: cr,
			HPAverage: hpAverage, HPFormula: hpFormula,
			Dexterity: monster.Dexterity, Actions: actions, Original: bytes.TrimSpace(raw),
		})
	}
	if len(result.Document.Records) == 0 {
		return result, fmt.Errorf("no valid monster records to import")
	}
	return result, nil
}

func normalizeCreatureType(raw json.RawMessage) (string, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		if strings.TrimSpace(text) == "" {
			return "", fmt.Errorf("empty creature type")
		}
		return text, nil
	}
	var object struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &object); err != nil || strings.TrimSpace(object.Type) == "" {
		return "", fmt.Errorf("unsupported creature type value")
	}
	return object.Type, nil
}

func normalizeCR(raw json.RawMessage) (string, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		if strings.TrimSpace(text) == "" {
			return "", fmt.Errorf("empty challenge rating")
		}
		return text, nil
	}
	var object struct {
		CR string `json:"cr"`
	}
	if err := json.Unmarshal(raw, &object); err != nil || strings.TrimSpace(object.CR) == "" {
		return "", fmt.Errorf("unsupported challenge rating value")
	}
	return object.CR, nil
}

func readArray(input io.Reader, key, label string) ([]json.RawMessage, error) {
	var root map[string]json.RawMessage
	decoder := json.NewDecoder(input)
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("decode %s document: %w", label, err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("%s document must contain one JSON value", label)
		}
		return nil, fmt.Errorf("decode trailing data: %w", err)
	}
	raw, ok := root[key]
	if !ok {
		return nil, fmt.Errorf("%s document has no %s array", label, key)
	}
	var records []json.RawMessage
	if err := json.Unmarshal(raw, &records); err != nil {
		return nil, fmt.Errorf("decode %s array: %w", label, err)
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("%s document has no %s records", label, key)
	}
	return records, nil
}
