package world

import (
	"strings"
)

// Slugify converts a human-readable value into a lowercase URL-safe key.
func Slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	builder.Grow(len(value))
	pendingDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if pendingDash && builder.Len() > 0 {
				builder.WriteByte('-')
			}
			pendingDash = false
			builder.WriteRune(r)
			continue
		}
		if r == '\'' || r == '\u2019' {
			continue
		}
		pendingDash = true
	}
	return strings.Trim(builder.String(), "-")
}

// NormalizeTypeClass maps a raw vault type to the supported entity type class.
// An empty raw type is not an unknown type; callers should infer it from the folder.
func NormalizeTypeClass(rawType string) (typeClass string, known bool) {
	switch strings.TrimSpace(rawType) {
	case "":
		return "", false
	case "location":
		return "location", true
	case "actor":
		return "actor", true
	case "group":
		return "group", true
	case "event":
		return "event", true
	case "thread", "plot":
		return "thread", true
	case "creature", "setting":
		return "concept", true
	default:
		return "", false
	}
}

func folderSegments(folder string) []string {
	folder = strings.ReplaceAll(folder, "\\", "/")
	folder = strings.Trim(folder, "/")
	if folder == "" || folder == "." {
		return nil
	}
	return strings.Split(folder, "/")
}

func equalSegment(segments []string, index int, value string) bool {
	return index < len(segments) && strings.EqualFold(segments[index], value)
}

// InferTypeClassFromFolder picks the type class implied by a vault folder path.
func InferTypeClassFromFolder(folder string) string {
	segments := folderSegments(folder)
	if len(segments) == 0 {
		return "note"
	}
	switch {
	case equalSegment(segments, 0, "World"):
		if equalSegment(segments, 1, "Locations") {
			return "location"
		}
		if equalSegment(segments, 1, "Actors") {
			return "actor"
		}
		if equalSegment(segments, 1, "Groups") {
			return "group"
		}
		if equalSegment(segments, 1, "Creatures") || equalSegment(segments, 1, "Settings") || equalSegment(segments, 1, "Items") {
			return "concept"
		}
	case equalSegment(segments, 0, "Timeline"):
		if equalSegment(segments, 1, "Events") {
			return "event"
		}
		if equalSegment(segments, 1, "Threads") {
			return "thread"
		}
	case equalSegment(segments, 0, "Rules"):
		return "concept"
	}
	return "note"
}

// InferScope decides whether a note belongs to the world, rules, or notes scope.
func InferScope(folder string) string {
	segments := folderSegments(folder)
	if len(segments) == 0 {
		return "notes"
	}
	switch {
	case equalSegment(segments, 0, "Rules"):
		return "rules"
	case equalSegment(segments, 0, "Campaigns"), equalSegment(segments, 0, "Notes"), equalSegment(segments, 0, "Files"):
		return "notes"
	default:
		return "world"
	}
}

// InferCampaignFromFolder returns the campaign implied by a Campaigns/<Name> path.
func InferCampaignFromFolder(folder string) (key string, name string, ok bool) {
	segments := folderSegments(folder)
	if len(segments) < 2 || !strings.EqualFold(segments[0], "Campaigns") {
		return "", "", false
	}
	name = strings.TrimSpace(segments[1])
	if name == "" {
		return "", "", false
	}
	key = Slugify(name)
	if key == "" {
		return "", "", false
	}
	return key, name, true
}

// NormalizeRelationKey removes whitespace and folds the known duplicate link keys.
func NormalizeRelationKey(key string) (normalized string, renamed bool) {
	trimmed := strings.TrimSpace(key)
	switch trimmed {
	case "in":
		normalized = "In"
	case "Quest", "Quests":
		normalized = "Quests"
	case "group":
		normalized = "Gruppen"
	default:
		normalized = trimmed
	}
	return normalized, normalized != trimmed
}
