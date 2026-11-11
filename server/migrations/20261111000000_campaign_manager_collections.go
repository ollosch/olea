package migrations

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

type relationTypeSeed struct {
	key          string
	label        string
	inverseLabel string
	hierarchical bool
}

var relationTypeSeeds = []relationTypeSeed{
	{key: "In", label: "In", inverseLabel: "Enthält", hierarchical: true},
	{key: "in", label: "In", inverseLabel: "Enthält", hierarchical: true},
	{key: "Übergruppe", label: "Übergruppe", inverseLabel: "Untergruppen", hierarchical: true},
	{key: "Lebt in", label: "Lebt in", inverseLabel: "Bewohnt von"},
	{key: "Gruppen", label: "Gruppen", inverseLabel: "Mitglieder"},
	{key: "Herrscher", label: "Herrscher", inverseLabel: "Herrscht über"},
	{key: "Besitzer", label: "Besitzer", inverseLabel: "Besitzt"},
	{key: "Betreiber", label: "Betreiber", inverseLabel: "Betrieben von"},
	{key: "Betreibt", label: "Betreibt", inverseLabel: "Betrieben von"},
	{key: "Anführer", label: "Anführer", inverseLabel: "Angeführt von"},
	{key: "HQ", label: "HQ", inverseLabel: "Hauptquartier von"},
	{key: "Geber", label: "Geber", inverseLabel: "Gibt Auftrag"},
	{key: "Quest", label: "Quest", inverseLabel: "Quest von"},
	{key: "Quests", label: "Quest", inverseLabel: "Quest von"},
	{key: "Religion", label: "Religion", inverseLabel: "Verehrt von"},
	{key: "Regent", label: "Regent", inverseLabel: "Regiert"},
	{key: "Freunde", label: "Freunde", inverseLabel: "Freunde von"},
	{key: "Feinde", label: "Feinde", inverseLabel: "Feinde von"},
	{key: "Vater", label: "Vater", inverseLabel: "Kind von"},
	{key: "Mutter", label: "Mutter", inverseLabel: "Kind von"},
	{key: "Sohn", label: "Sohn", inverseLabel: "Elternteil von"},
	{key: "Kinder", label: "Kinder", inverseLabel: "Elternteil von"},
	{key: "Brüder", label: "Brüder", inverseLabel: "Geschwister von"},
	{key: "Onkel", label: "Onkel", inverseLabel: "Nichte/Neffe von"},
}

func init() {
	m.Register(func(app core.App) error {
		systems, err := app.FindCollectionByNameOrId("systems")
		if err != nil {
			return err
		}

		campaigns := core.NewBaseCollection("campaigns")
		campaigns.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 120},
			&core.TextField{Name: "name", Required: true, Max: 160},
			&core.TextField{Name: "description", Max: 100000},
			&core.TextField{Name: "color", Max: 32},
		)
		campaigns.AddIndex("idx_campaigns_key", true, "key", "")
		setPublicRules(campaigns)
		if err := app.Save(campaigns); err != nil {
			return err
		}

		entities := core.NewBaseCollection("entities")
		entities.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 500},
			&core.SelectField{Name: "type_class", MaxSelect: 1, Values: []string{"location", "actor", "group", "concept", "thread", "event", "note"}},
			&core.TextField{Name: "template", Max: 200},
			&core.TextField{Name: "source_type", Max: 200},
			&core.TextField{Name: "status", Max: 200},
			&core.TextField{Name: "folder", Max: 1000},
			&core.TextField{Name: "event_date", Max: 64},
			&core.JSONField{Name: "data", MaxSize: 10000000},
			&core.JSONField{Name: "links", MaxSize: 10000000},
			&core.JSONField{Name: "meta", MaxSize: 10000000},
			&core.JSONField{Name: "aliases", MaxSize: 10000000},
			&core.TextField{Name: "body", Max: 10000000},
			&core.RelationField{Name: "campaigns", MaxSelect: 100, CollectionId: campaigns.Id},
			&core.SelectField{Name: "scope", MaxSelect: 1, Values: []string{"world", "rules", "notes"}},
			&core.RelationField{Name: "system", MaxSelect: 1, CollectionId: systems.Id},
			&core.TextField{Name: "source_path", Max: 2000},
			&core.TextField{Name: "source_hash", Max: 128},
		)
		entities.AddIndex("idx_entities_type_class", false, "type_class", "")
		entities.AddIndex("idx_entities_template", false, "template", "")
		entities.AddIndex("idx_entities_source_path", true, "source_path", "source_path != ''")
		entities.AddIndex("idx_entities_event_date", false, "event_date", "")
		entities.AddIndex("idx_entities_folder", false, "folder", "")
		setPublicRules(entities)
		if err := app.Save(entities); err != nil {
			return err
		}

		relationTypes := core.NewBaseCollection("relation_types")
		relationTypes.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 120},
			&core.TextField{Name: "label", Required: true, Max: 200},
			&core.TextField{Name: "inverse_label", Required: true, Max: 200},
			&core.BoolField{Name: "hierarchical"},
			&core.JSONField{Name: "source_classes", MaxSize: 1000000},
			&core.JSONField{Name: "target_classes", MaxSize: 1000000},
			&core.TextField{Name: "notes", Max: 10000},
		)
		relationTypes.ListRule = types.Pointer("")
		relationTypes.ViewRule = types.Pointer("")
		relationTypes.AddIndex("idx_relation_types_key", true, "key", "")
		if err := app.Save(relationTypes); err != nil {
			return err
		}

		relations := core.NewBaseCollection("relations")
		relations.Fields.Add(
			&core.RelationField{Name: "from", Required: true, MaxSelect: 1, CollectionId: entities.Id, CascadeDelete: true},
			&core.RelationField{Name: "to", MaxSelect: 1, CollectionId: entities.Id, CascadeDelete: true},
			&core.RelationField{Name: "type", Required: true, MaxSelect: 1, CollectionId: relationTypes.Id, CascadeDelete: true},
			&core.TextField{Name: "unresolved_name", Max: 500},
			&core.TextField{Name: "note", Max: 10000},
		)
		relations.AddIndex("idx_relations_from", false, "`from`", "")
		relations.AddIndex("idx_relations_to", false, "`to`", "")
		relations.AddIndex("idx_relations_type", false, "`type`", "")
		relations.AddIndex("idx_relations_unique", true, "`from`,`to`,`type`", "`to` != ''")
		setPublicRules(relations)
		if err := app.Save(relations); err != nil {
			return err
		}

		mentions := core.NewBaseCollection("mentions")
		mentions.Fields.Add(
			&core.RelationField{Name: "source", Required: true, MaxSelect: 1, CollectionId: entities.Id, CascadeDelete: true},
			&core.RelationField{Name: "target", MaxSelect: 1, CollectionId: entities.Id, CascadeDelete: true},
			&core.TextField{Name: "target_name", Required: true, Max: 500},
		)
		mentions.AddIndex("idx_mentions_source", false, "source", "")
		mentions.AddIndex("idx_mentions_target", false, "target", "")
		mentions.AddIndex("idx_mentions_target_name", false, "target_name", "")
		setPublicRules(mentions)
		if err := app.Save(mentions); err != nil {
			return err
		}

		maps := core.NewBaseCollection("maps")
		maps.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 500},
			&core.RelationField{Name: "campaign", MaxSelect: 1, CollectionId: campaigns.Id},
			&core.TextField{Name: "image", Max: 2000},
			&core.JSONField{Name: "config", MaxSize: 1000000},
		)
		setPublicRules(maps)
		if err := app.Save(maps); err != nil {
			return err
		}

		mapMarkers := core.NewBaseCollection("map_markers")
		mapMarkers.Fields.Add(
			&core.RelationField{Name: "map", Required: true, MaxSelect: 1, CollectionId: maps.Id, CascadeDelete: true},
			&core.RelationField{Name: "entity", MaxSelect: 1, CollectionId: entities.Id, CascadeDelete: true},
			&core.NumberField{Name: "x", Required: true},
			&core.NumberField{Name: "y", Required: true},
			&core.TextField{Name: "label", Max: 500},
		)
		setPublicRules(mapMarkers)
		if err := app.Save(mapMarkers); err != nil {
			return err
		}

		if err := seedSystems(app, systems); err != nil {
			return err
		}
		return seedRelationTypes(app, relationTypes)
	}, func(app core.App) error {
		for _, name := range []string{"map_markers", "maps", "mentions", "relations", "relation_types", "entities", "campaigns"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}

func seedSystems(app core.App, systems *core.Collection) error {
	seeds := []struct {
		key  string
		name string
	}{
		{key: "dnd5e", name: "D&D 5e"},
		{key: "adnd2e", name: "AD&D 2e"},
		{key: "ose", name: "OSE"},
	}
	for _, seed := range seeds {
		_, err := app.FindFirstRecordByData("systems", "key", seed.key)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		record := core.NewRecord(systems)
		record.Set("key", seed.key)
		record.Set("name", seed.name)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func seedRelationTypes(app core.App, relationTypes *core.Collection) error {
	for _, seed := range relationTypeSeeds {
		_, err := app.FindFirstRecordByData("relation_types", "key", seed.key)
		if err == nil {
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		record := core.NewRecord(relationTypes)
		record.Set("key", seed.key)
		record.Set("label", seed.label)
		record.Set("inverse_label", seed.inverseLabel)
		record.Set("hierarchical", seed.hierarchical)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}
