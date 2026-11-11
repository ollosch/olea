package world

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/tools/types"
)

// DecodeJSON decodes the various JSON shapes PocketBase may return.
func DecodeJSON(value any, target any) error {
	switch typed := value.(type) {
	case nil:
		return nil
	case types.JSONRaw:
		if len(typed) == 0 {
			return nil
		}
		return json.Unmarshal(typed, target)
	case []byte:
		if len(typed) == 0 {
			return nil
		}
		return json.Unmarshal(typed, target)
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return json.Unmarshal([]byte(typed), target)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return err
		}
		if string(encoded) == "null" {
			return nil
		}
		return json.Unmarshal(encoded, target)
	}
}

func stringList(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		return []string{trimmed}
	case []string:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, stringList(item)...)
		}
		return result
	default:
		return nil
	}
}
