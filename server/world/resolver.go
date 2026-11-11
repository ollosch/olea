package world

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Resolver maps entity names and aliases to record IDs. The first added name wins.
type Resolver struct {
	exact map[string]string
	lower map[string]string
}

func NewResolver() *Resolver {
	return &Resolver{
		exact: map[string]string{},
		lower: map[string]string{},
	}
}

func (r *Resolver) Add(name, id string) bool {
	name = strings.TrimSpace(name)
	if name == "" || id == "" {
		return false
	}
	if _, exists := r.exact[name]; exists {
		return false
	}
	r.exact[name] = id
	key := strings.ToLower(name)
	if _, exists := r.lower[key]; !exists {
		r.lower[key] = id
	}
	return true
}

func (r *Resolver) Resolve(name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", false
	}
	if id, ok := r.exact[name]; ok {
		return id, true
	}
	id, ok := r.lower[strings.ToLower(name)]
	return id, ok
}

// LoadResolver builds a resolver from all stored entities and their aliases.
func LoadResolver(app core.App) (*Resolver, error) {
	records, err := app.FindRecordsByFilter("entities", "", "", 0, 0)
	if err != nil {
		return nil, err
	}
	resolver := NewResolver()
	for _, record := range records {
		resolver.Add(record.GetString("name"), record.Id)
		var aliases any
		if err := DecodeJSON(record.Get("aliases"), &aliases); err != nil {
			continue
		}
		for _, alias := range stringList(aliases) {
			resolver.Add(alias, record.Id)
		}
	}
	return resolver, nil
}

// EnsureRelationType returns the relation type with the given key, creating it if needed.
func EnsureRelationType(app core.App, key string) (record *core.Record, created bool, err error) {
	record, err = app.FindFirstRecordByData("relation_types", "key", key)
	if err == nil {
		return record, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}
	collection, err := app.FindCachedCollectionByNameOrId("relation_types")
	if err != nil {
		return nil, false, err
	}
	record = core.NewRecord(collection)
	record.Id = core.GenerateDefaultRandomId()
	record.Set("key", key)
	record.Set("label", key)
	record.Set("inverse_label", "verweist auf")
	record.Set("hierarchical", false)
	if err := app.Save(record); err != nil {
		return nil, false, err
	}
	return record, true, nil
}
