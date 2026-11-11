package world

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// RebuildPaths rebuilds the hierarchical entity closure table.
func RebuildPaths(app core.App) (rows int, err error) {
	if _, err := app.DB().NewQuery("DELETE FROM entity_paths").Execute(); err != nil {
		return 0, err
	}

	var entityIDs []string
	if err := app.DB().NewQuery("SELECT id FROM entities").Column(&entityIDs); err != nil {
		return 0, err
	}
	sort.Strings(entityIDs)

	var typeIDs []string
	if err := app.DB().NewQuery("SELECT id FROM relation_types WHERE hierarchical = true").Column(&typeIDs); err != nil {
		return 0, err
	}

	parentsByChild := map[string][]string{}
	if len(typeIDs) > 0 {
		params := dbx.Params{}
		placeholders := make([]string, 0, len(typeIDs))
		for index, id := range typeIDs {
			key := fmt.Sprintf("type%d", index)
			placeholders = append(placeholders, "{:"+key+"}")
			params[key] = id
		}
		query := "SELECT `from` AS child_id, `to` AS parent_id FROM relations WHERE `to` != '' AND `type` IN (" + strings.Join(placeholders, ", ") + ")"
		var links []struct {
			ChildID  string `db:"child_id"`
			ParentID string `db:"parent_id"`
		}
		if err := app.DB().NewQuery(query).Bind(params).All(&links); err != nil {
			return 0, err
		}
		for _, link := range links {
			parentsByChild[link.ChildID] = append(parentsByChild[link.ChildID], link.ParentID)
		}
	}

	insert := app.DB().NewQuery("INSERT OR IGNORE INTO entity_paths (ancestor_id, descendant_id, depth) VALUES ({:ancestor}, {:descendant}, {:depth})")
	seen := map[string]bool{}
	insertRow := func(ancestorID, descendantID string, depth int) error {
		key := ancestorID + "\x00" + descendantID + "\x00" + strconv.Itoa(depth)
		if seen[key] {
			return nil
		}
		seen[key] = true
		if _, err := insert.Bind(dbx.Params{
			"ancestor":   ancestorID,
			"descendant": descendantID,
			"depth":      depth,
		}).Execute(); err != nil {
			return err
		}
		rows++
		return nil
	}

	for _, entityID := range entityIDs {
		if err := insertRow(entityID, entityID, 0); err != nil {
			return 0, err
		}

		type step struct {
			id    string
			depth int
		}
		visited := map[string]bool{entityID: true}
		queue := make([]step, 0, len(parentsByChild[entityID]))
		for _, parentID := range parentsByChild[entityID] {
			if visited[parentID] {
				continue
			}
			visited[parentID] = true
			queue = append(queue, step{id: parentID, depth: 1})
		}
		for len(queue) > 0 {
			current := queue[0]
			queue = queue[1:]
			if err := insertRow(current.id, entityID, current.depth); err != nil {
				return 0, err
			}
			for _, parentID := range parentsByChild[current.id] {
				if visited[parentID] {
					continue
				}
				visited[parentID] = true
				queue = append(queue, step{id: parentID, depth: current.depth + 1})
			}
		}
	}

	return rows, nil
}
