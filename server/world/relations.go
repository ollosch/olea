package world

import (
	"fmt"
	"sort"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type RelationSyncResult struct {
	Count           int      `json:"count"`
	CreatedTypeKeys []string `json:"created_relation_types,omitempty"`
	Renames         []string `json:"renames,omitempty"`
	UnresolvedNames []string `json:"unresolved_names,omitempty"`
	Warnings        []string `json:"warnings,omitempty"`
}

// FlattenLinkTargets turns a link value into a flat list of string targets.
func FlattenLinkTargets(value any) (targets []string, warnings []string) {
	switch typed := value.(type) {
	case nil:
		return nil, nil
	case string:
		return []string{typed}, nil
	case []string:
		for _, item := range typed {
			nestedTargets, nestedWarnings := FlattenLinkTargets(item)
			targets = append(targets, nestedTargets...)
			warnings = append(warnings, nestedWarnings...)
		}
		return targets, warnings
	case []any:
		for _, item := range typed {
			nestedTargets, nestedWarnings := FlattenLinkTargets(item)
			targets = append(targets, nestedTargets...)
			warnings = append(warnings, nestedWarnings...)
		}
		return targets, warnings
	default:
		return nil, []string{fmt.Sprintf("skipping link target of unsupported type %T", value)}
	}
}

func appendUnique(values []string, seen map[string]bool, value string) []string {
	if seen[value] {
		return values
	}
	seen[value] = true
	return append(values, value)
}

// SyncEntityRelations replaces an entity's stored relations with the ones derived from links.
func SyncEntityRelations(app core.App, entity *core.Record, resolver *Resolver) (RelationSyncResult, error) {
	var result RelationSyncResult
	if entity == nil {
		return result, fmt.Errorf("sync relations: entity is nil")
	}
	if resolver == nil {
		resolver = NewResolver()
	}
	unsafeApp := app.UnsafeWithoutHooks()

	existing, err := app.FindRecordsByFilter("relations", "from = {:from}", "", 0, 0, dbx.Params{"from": entity.Id})
	if err != nil {
		return result, err
	}
	for _, relation := range existing {
		if err := unsafeApp.Delete(relation); err != nil {
			return result, err
		}
	}

	var links any
	if err := DecodeJSON(entity.Get("links"), &links); err != nil {
		return result, fmt.Errorf("decode links: %w", err)
	}
	if links == nil {
		return result, nil
	}

	mapping, isMapping := links.(map[string]any)
	if !isMapping {
		switch typed := links.(type) {
		case []any:
			if len(typed) > 0 {
				result.Warnings = append(result.Warnings, "untyped link lists are not imported")
			}
		case []string:
			if len(typed) > 0 {
				result.Warnings = append(result.Warnings, "untyped link lists are not imported")
			}
		case string:
			if strings.TrimSpace(typed) != "" {
				result.Warnings = append(result.Warnings, "untyped link lists are not imported")
			}
		default:
			result.Warnings = append(result.Warnings, fmt.Sprintf("skipping unsupported links value of type %T", typed))
		}
		return result, nil
	}

	keys := make([]string, 0, len(mapping))
	for key := range mapping {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	relationsCollection, err := app.FindCachedCollectionByNameOrId("relations")
	if err != nil {
		return result, err
	}

	createdKeys := map[string]bool{}
	renamesSeen := map[string]bool{}
	dedupe := map[string]bool{}
	for _, rawKey := range keys {
		key, renamed := NormalizeRelationKey(rawKey)
		if key == "" {
			result.Warnings = append(result.Warnings, "skipping empty relation key")
			continue
		}
		if renamed {
			result.Renames = appendUnique(result.Renames, renamesSeen, fmt.Sprintf("%q -> %q", rawKey, key))
		}

		relationType, created, err := EnsureRelationType(app, key)
		if err != nil {
			return result, err
		}
		if created {
			result.CreatedTypeKeys = appendUnique(result.CreatedTypeKeys, createdKeys, key)
		}

		targets, warnings := FlattenLinkTargets(mapping[rawKey])
		result.Warnings = append(result.Warnings, warnings...)
		for _, rawTarget := range targets {
			target := strings.TrimSpace(rawTarget)
			if target == "" {
				continue
			}

			to := ""
			unresolvedName := ""
			if resolvedID, ok := resolver.Resolve(target); ok {
				if resolvedID == entity.Id {
					result.Warnings = append(result.Warnings, fmt.Sprintf("skipping self relation %q (%s)", target, key))
					continue
				}
				to = resolvedID
			} else {
				unresolvedName = target
			}

			dedupeKey := strings.Join([]string{relationType.Id, to, unresolvedName}, "\x00")
			if dedupe[dedupeKey] {
				continue
			}
			dedupe[dedupeKey] = true

			relation := core.NewRecord(relationsCollection)
			relation.Id = core.GenerateDefaultRandomId()
			relation.Set("from", entity.Id)
			relation.Set("to", to)
			relation.Set("type", relationType.Id)
			relation.Set("unresolved_name", unresolvedName)
			if err := unsafeApp.Save(relation); err != nil {
				return result, err
			}
			result.Count++
			if unresolvedName != "" {
				result.UnresolvedNames = append(result.UnresolvedNames, unresolvedName)
			}
		}
	}
	return result, nil
}
