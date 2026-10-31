package dnd5eimport

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	"olea/catalogimport"
)

type itemRecord map[string]any

type itemIdentity struct {
	Name   string
	Source string
}

// ParseItems imports items, resolving copies recursively when their base exists.
// itemGroup definitions are reported separately because they describe bundles, not items.
func ParseItems(input io.Reader) (Result, error) {
	var root struct {
		Items  []json.RawMessage `json:"item"`
		Groups []json.RawMessage `json:"itemGroup"`
	}
	decoder := json.NewDecoder(input)
	if err := decoder.Decode(&root); err != nil {
		return Result{}, fmt.Errorf("decode items document: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return Result{}, fmt.Errorf("items document must contain one JSON value")
		}
		return Result{}, fmt.Errorf("decode trailing data: %w", err)
	}
	if len(root.Items) == 0 {
		return Result{}, fmt.Errorf("items document has no item records")
	}

	items := make([]itemRecord, 0, len(root.Items))
	indices := make(map[itemIdentity]int, len(root.Items))
	result := Result{Groups: len(root.Groups)}
	for i, raw := range root.Items {
		var item itemRecord
		if err := json.Unmarshal(raw, &item); err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("item %d: invalid record: %v", i+1, err))
			items = append(items, nil)
			continue
		}
		identity := itemIdentity{stringValue(item["name"]), stringValue(item["source"])}
		if identity.Name == "" || identity.Source == "" {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("item %d: missing name or source", i+1))
			items = append(items, nil)
			continue
		}
		if _, exists := indices[identity]; exists {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("item %q (%s): duplicate name/source identity", identity.Name, identity.Source))
			items = append(items, nil)
			continue
		}
		indices[identity] = len(items)
		items = append(items, item)
	}

	resolved := make(map[itemIdentity]itemRecord, len(items))
	resolving := make(map[itemIdentity]bool)
	var resolve func(itemIdentity) (itemRecord, error)
	resolve = func(identity itemIdentity) (itemRecord, error) {
		if cached := resolved[identity]; cached != nil {
			return cached, nil
		}
		index, exists := indices[identity]
		if !exists || items[index] == nil {
			return nil, fmt.Errorf("base item %q (%s) is missing", identity.Name, identity.Source)
		}
		if resolving[identity] {
			return nil, fmt.Errorf("copy cycle at %q (%s)", identity.Name, identity.Source)
		}
		resolving[identity] = true
		defer delete(resolving, identity)
		item := cloneItem(items[index])
		if copyRaw, ok := item["_copy"]; ok {
			copyDef, ok := copyRaw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid _copy definition")
			}
			baseIdentity := itemIdentity{stringValue(copyDef["name"]), stringValue(copyDef["source"])}
			if baseIdentity.Name == "" || baseIdentity.Source == "" {
				return nil, fmt.Errorf("_copy requires a base name and source")
			}
			base, err := resolve(baseIdentity)
			if err != nil {
				return nil, err
			}
			preserve := stringMap(copyDef["_preserve"])
			for key, value := range base {
				if key == "_copy" || key == "name" || key == "source" || key == "page" || preserve[key] == true {
					continue
				}
				if _, overridden := item[key]; !overridden {
					item[key] = cloneValue(value)
				}
			}
			if err := applyItemMods(item, copyDef["_mod"]); err != nil {
				return nil, err
			}
		}
		resolved[identity] = item
		return item, nil
	}

	for i, original := range items {
		if original == nil {
			continue
		}
		identity := itemIdentity{stringValue(original["name"]), stringValue(original["source"])}
		item, err := resolve(identity)
		if err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("item %q (%s): could not resolve inheritance: %v", identity.Name, identity.Source, err))
			continue
		}
		record, err := normalizeItem(item)
		if err != nil {
			result.Skipped++
			result.Warnings = append(result.Warnings, fmt.Sprintf("item %q (%s): %v", identity.Name, identity.Source, err))
			continue
		}
		raw, err := json.Marshal(item)
		if err != nil {
			return Result{}, fmt.Errorf("encode item %d: %w", i+1, err)
		}
		record.Original = raw
		result.Document.Records = append(result.Document.Records, record)
	}
	if result.Groups > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("%d itemGroup bundle definitions skipped deliberately; they are reported separately and not imported as standalone items", result.Groups))
	}
	if len(result.Document.Records) == 0 {
		return result, fmt.Errorf("no valid item records to import")
	}
	return result, nil
}

func normalizeItem(item itemRecord) (catalogimport.InputRecord, error) {
	name, source := stringValue(item["name"]), stringValue(item["source"])
	if name == "" || source == "" {
		return catalogimport.InputRecord{}, fmt.Errorf("missing name or source after inheritance")
	}
	record := catalogimport.InputRecord{Type: "item", Name: name, Source: source, SourceID: name}
	if weight, ok := item["weight"]; ok && weight != nil {
		record.ItemWeight = json.RawMessage(marshalValue(weight))
	}
	if value, ok := item["value"]; ok {
		record.ItemValue = json.RawMessage(marshalValue(value))
	}
	if itemType, ok := item["type"]; ok {
		record.ItemType = json.RawMessage(marshalValue(itemType))
	}
	if rarity, ok := item["rarity"]; ok {
		record.Rarity = stringValue(rarity)
	}
	return record, nil
}

func applyItemMods(item itemRecord, raw any) error {
	mods := stringMap(raw)
	for key, definition := range mods {
		switch key {
		case "entries":
			if err := applyEntryMod(item, definition); err != nil {
				return fmt.Errorf("unsupported _mod.entries: %w", err)
			}
		default:
			return fmt.Errorf("unsupported _mod field %q", key)
		}
	}
	return nil
}

func applyEntryMod(item itemRecord, definition any) error {
	mods, ok := definition.([]any)
	if !ok {
		mods = []any{definition}
	}
	for _, rawMod := range mods {
		mod, ok := rawMod.(map[string]any)
		if !ok {
			return fmt.Errorf("modification is not an object")
		}
		mode := stringValue(mod["mode"])
		existing, ok := item["entries"].([]any)
		if !ok && (mode == "appendArr" || mode == "insertArr") {
			existing = []any{}
			ok = true
		}
		if mode == "replaceTxt" {
			pattern := stringValue(mod["replace"])
			if strings.EqualFold(stringValue(mod["flags"]), "i") {
				pattern = "(?i)" + pattern
			}
			re, err := regexp.Compile(pattern)
			if err != nil {
				return fmt.Errorf("invalid replaceTxt pattern: %w", err)
			}
			if !containsPattern(existing, re) {
				return fmt.Errorf("replaceTxt pattern %q did not match entries", mod["replace"])
			}
			item["entries"] = replacePattern(existing, re, stringValue(mod["with"]))
			continue
		}
		if !ok {
			return fmt.Errorf("base entries are not an array")
		}
		switch mode {
		case "appendArr":
			item["entries"] = append(existing, normalizeModItems(mod["items"])...)
		case "insertArr":
			index := integerValue(mod["index"], len(existing))
			if index < 0 {
				index = len(existing) + index
			}
			if index < 0 || index > len(existing) {
				return fmt.Errorf("insertArr index is out of bounds")
			}
			inserted := normalizeModItems(mod["items"])
			updated := append([]any{}, existing[:index]...)
			updated = append(updated, inserted...)
			item["entries"] = append(updated, existing[index:]...)
		case "replaceArr":
			replace, ok := mod["replace"].(map[string]any)
			if !ok {
				return fmt.Errorf("replaceArr requires an index selector")
			}
			index := integerValue(replace["index"], -1)
			if index < 0 {
				index = len(existing) + index
			}
			if index < 0 || index >= len(existing) {
				return fmt.Errorf("replaceArr index is out of bounds")
			}
			updated := append([]any{}, existing...)
			updated = append(updated[:index], append(normalizeModItems(mod["items"]), updated[index+1:]...)...)
			item["entries"] = updated
		default:
			return fmt.Errorf("unknown mode %q", mode)
		}
	}
	return nil
}

func containsPattern(value any, pattern *regexp.Regexp) bool {
	switch typed := value.(type) {
	case string:
		return pattern.MatchString(typed)
	case []any:
		for _, child := range typed {
			if containsPattern(child, pattern) {
				return true
			}
		}
	case map[string]any:
		for _, child := range typed {
			if containsPattern(child, pattern) {
				return true
			}
		}
	}
	return false
}

func replacePattern(value any, pattern *regexp.Regexp, replacement string) any {
	switch typed := value.(type) {
	case string:
		return pattern.ReplaceAllStringFunc(typed, func(string) string { return replacement })
	case []any:
		for i, child := range typed {
			typed[i] = replacePattern(child, pattern, replacement)
		}
	case map[string]any:
		for key, child := range typed {
			typed[key] = replacePattern(child, pattern, replacement)
		}
	}
	return value
}

func normalizeModItems(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return []any{value}
}

func stringMap(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return nil
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func integerValue(value any, fallback int) int {
	number, ok := value.(float64)
	if !ok {
		return fallback
	}
	return int(number)
}

func marshalValue(value any) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func cloneItem(source itemRecord) itemRecord {
	cloned := make(itemRecord, len(source))
	for key, value := range source {
		cloned[key] = cloneValue(value)
	}
	return cloned
}

func cloneValue(value any) any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var cloned any
	if json.Unmarshal(encoded, &cloned) != nil {
		return value
	}
	return cloned
}

var _ io.Reader = (io.Reader)(nil)
