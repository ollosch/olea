package world

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type SearchParams struct {
	Query    string
	Type     string
	Campaign string
	Exclude  string
	Limit    int
}

type SearchItem struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	TypeClass string   `json:"type_class"`
	Template  string   `json:"template"`
	Folder    string   `json:"folder"`
	Status    string   `json:"status"`
	EventDate string   `json:"event_date"`
	Campaigns []string `json:"campaigns"`
	Snippet   string   `json:"snippet"`
}

type SearchResult struct {
	Items []SearchItem `json:"items"`
	Limit int          `json:"limit"`
}

// Search queries entities with optional full-text search and filters.
func Search(app core.App, params SearchParams) (SearchResult, error) {
	result := SearchResult{Items: make([]SearchItem, 0)}
	limit := params.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	result.Limit = limit

	match := ftsPrefixQuery(params.Query)
	conditions := make([]string, 0, 4)
	bindings := dbx.Params{"limit": limit}

	if strings.TrimSpace(params.Type) != "" {
		conditions = append(conditions, "e.type_class = {:type}")
		bindings["type"] = params.Type
	}
	if strings.TrimSpace(params.Campaign) != "" {
		campaignID, err := resolveCampaign(app, params.Campaign)
		if err != nil {
			return result, err
		}
		conditions = append(conditions, "(COALESCE(json_array_length(e.campaigns), 0) = 0 OR EXISTS (SELECT 1 FROM json_each(e.campaigns) WHERE json_each.value = {:campaign}))")
		bindings["campaign"] = campaignID
	}
	if strings.TrimSpace(params.Exclude) != "" {
		conditions = append(conditions, "e.id != {:exclude}")
		bindings["exclude"] = params.Exclude
	}
	join := " LEFT JOIN entity_fts ON entity_fts.entity_id = e.id"
	snippet := "'' AS snippet"
	order := "COALESCE(e.name, '')"
	if match != "" {
		bindings["match"] = match
		join = " LEFT JOIN (SELECT entity_id, snippet(entity_fts, 2, '', '', '…', 30) AS snippet, " +
			"bm25(entity_fts) AS rank FROM entity_fts WHERE entity_fts MATCH {:match}) fts ON fts.entity_id = e.id"
		conditions = append(conditions, "fts.entity_id IS NOT NULL")
		snippet = "fts.snippet AS snippet"
		order = "fts.rank, COALESCE(e.name, '')"
	}

	query := "SELECT e.id, COALESCE(e.name, '') AS name, COALESCE(e.type_class, '') AS type_class, " +
		"COALESCE(e.template, '') AS template, COALESCE(e.folder, '') AS folder, COALESCE(e.status, '') AS status, " +
		"COALESCE(e.event_date, '') AS event_date, COALESCE(e.campaigns, '[]') AS campaigns, " + snippet +
		" FROM entities e" + join
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY " + order + " LIMIT {:limit}"

	var rows []struct {
		ID        string `db:"id"`
		Name      string `db:"name"`
		TypeClass string `db:"type_class"`
		Template  string `db:"template"`
		Folder    string `db:"folder"`
		Status    string `db:"status"`
		EventDate string `db:"event_date"`
		Campaigns string `db:"campaigns"`
		Snippet   string `db:"snippet"`
	}
	if err := app.DB().NewQuery(query).Bind(bindings).All(&rows); err != nil {
		return result, err
	}

	campaigns, err := app.FindRecordsByFilter("campaigns", "", "id", 0, 0)
	if err != nil {
		return result, err
	}
	campaignKeys := make(map[string]string, len(campaigns))
	for _, campaign := range campaigns {
		campaignKeys[campaign.Id] = campaign.GetString("key")
	}

	for _, row := range rows {
		var campaignIDs []string
		if err := DecodeJSON(row.Campaigns, &campaignIDs); err != nil {
			return result, err
		}
		keys := make([]string, 0, len(campaignIDs))
		for _, id := range campaignIDs {
			if key, ok := campaignKeys[id]; ok {
				keys = append(keys, key)
			}
		}
		result.Items = append(result.Items, SearchItem{
			ID:        row.ID,
			Name:      row.Name,
			TypeClass: row.TypeClass,
			Template:  row.Template,
			Folder:    row.Folder,
			Status:    row.Status,
			EventDate: row.EventDate,
			Campaigns: keys,
			Snippet:   row.Snippet,
		})
	}
	return result, nil
}

func resolveCampaign(app core.App, value string) (string, error) {
	value = strings.TrimSpace(value)
	if record, err := app.FindRecordById("campaigns", value); err == nil {
		return record.Id, nil
	}
	if record, err := app.FindFirstRecordByData("campaigns", "key", value); err == nil {
		return record.Id, nil
	}
	return "", fmt.Errorf("campaign %q not found", value)
}

func ftsPrefixQuery(query string) string {
	terms := make([]string, 0)
	for _, field := range strings.Fields(query) {
		var builder strings.Builder
		for _, r := range field {
			if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' {
				builder.WriteRune(r)
			}
		}
		if builder.Len() > 0 {
			terms = append(terms, builder.String()+"*")
		}
	}
	return strings.Join(terms, " ")
}
