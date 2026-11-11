package world

import (
	"regexp"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type MentionSyncResult struct {
	Count           int      `json:"count"`
	UnresolvedNames []string `json:"unresolved_names,omitempty"`
	Warnings        []string `json:"warnings,omitempty"`
}

var wikilinkPattern = regexp.MustCompile(`(!?)\[\[([^\]\n]+)\]\]`)

var mediaExtensions = []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"}

func isMediaTarget(target string) bool {
	lower := strings.ToLower(target)
	for _, extension := range mediaExtensions {
		if strings.HasSuffix(lower, extension) {
			return true
		}
	}
	return false
}

func cleanWikilinkTarget(content string) string {
	target := content
	if index := strings.Index(target, "|"); index >= 0 {
		target = target[:index]
	}
	if index := strings.IndexAny(target, "#^"); index >= 0 {
		target = target[:index]
	}
	return strings.TrimSpace(target)
}

// SyncEntityMentions replaces an entity's stored mentions with body wikilink targets.
func SyncEntityMentions(app core.App, entity *core.Record, resolver *Resolver) (MentionSyncResult, error) {
	var result MentionSyncResult
	if entity == nil {
		return result, nil
	}
	if resolver == nil {
		resolver = NewResolver()
	}

	existing, err := app.FindRecordsByFilter("mentions", "source = {:source}", "", 0, 0, dbx.Params{"source": entity.Id})
	if err != nil {
		return result, err
	}
	for _, mention := range existing {
		if err := app.Delete(mention); err != nil {
			return result, err
		}
	}

	mentionsCollection, err := app.FindCachedCollectionByNameOrId("mentions")
	if err != nil {
		return result, err
	}

	seen := map[string]bool{}
	for _, match := range wikilinkPattern.FindAllStringSubmatch(entity.GetString("body"), -1) {
		if match[1] == "!" {
			continue
		}
		target := cleanWikilinkTarget(match[2])
		if target == "" || isMediaTarget(target) || seen[target] {
			continue
		}
		seen[target] = true

		resolvedID, ok := resolver.Resolve(target)
		mention := core.NewRecord(mentionsCollection)
		mention.Id = core.GenerateDefaultRandomId()
		mention.Set("source", entity.Id)
		mention.Set("target", resolvedID)
		mention.Set("target_name", target)
		if err := app.Save(mention); err != nil {
			return result, err
		}
		result.Count++
		if !ok {
			result.UnresolvedNames = append(result.UnresolvedNames, target)
		}
	}
	return result, nil
}
