package vaultimport

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"olea/world"
)

var filenameDatePattern = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})`)

var knownTemplates = map[string]bool{
	"settlement": true,
	"npc":        true,
	"plane":      true,
	"group":      true,
	"deity":      true,
	"faction":    true,
	"quest":      true,
	"pc":         true,
	"nature":     true,
	"creature":   true,
	"front":      true,
	"poi":        true,
	"dungeon":    true,
	"region":     true,
	"home":       true,
	"trader":     true,
	"office":     true,
	"text":       true,
	"temple":     true,
}

type Report struct {
	FilesScanned         int      `json:"files_scanned"`
	EntitiesCreated      int      `json:"entities_created"`
	EntitiesUpdated      int      `json:"entities_updated"`
	EntitiesUnchanged    int      `json:"entities_unchanged"`
	CampaignsCreated     int      `json:"campaigns_created"`
	RelationTypesCreated int      `json:"relation_types_created"`
	Relations            int      `json:"relations"`
	Mentions             int      `json:"mentions"`
	TimelineSkipped      int      `json:"timeline_skipped"`
	UnknownTypes         []string `json:"unknown_types,omitempty"`
	UnknownTemplates     []string `json:"unknown_templates,omitempty"`
	DuplicateBasenames   []string `json:"duplicate_basenames,omitempty"`
	RelationRenames      []string `json:"relation_renames,omitempty"`
	UnresolvedRelations  []string `json:"unresolved_relations,omitempty"`
	UnresolvedMentions   []string `json:"unresolved_mentions,omitempty"`
	SkippedFiles         []string `json:"skipped_files,omitempty"`
	Warnings             []string `json:"warnings,omitempty"`
}

type campaignRef struct {
	key  string
	name string
}

type vaultFile struct {
	relPath         string
	folder          string
	name            string
	hash            string
	rawType         string
	typeClass       string
	template        string
	status          string
	eventDate       string
	data            any
	links           any
	meta            any
	aliases         []any
	scope           string
	body            string
	campaignRefs    []campaignRef
	campaignIDs     []string
	unknownType     string
	unknownTemplate string
}

// Import reads a markdown vault and upserts it into the campaign-manager collections.
func Import(app core.App, vaultPath string) (Report, error) {
	absolutePath, err := filepath.Abs(vaultPath)
	if err != nil {
		return Report{}, fmt.Errorf("resolve vault path %q: %w", vaultPath, err)
	}
	info, err := os.Stat(absolutePath)
	if err != nil {
		return Report{}, fmt.Errorf("vault path %q: %w", vaultPath, err)
	}
	if !info.IsDir() {
		return Report{}, fmt.Errorf("vault path %q is not a directory", vaultPath)
	}

	var report Report
	err = app.RunInTransaction(func(txApp core.App) error {
		imported, importErr := importVault(txApp, absolutePath)
		if importErr != nil {
			return importErr
		}
		report = imported
		return nil
	})
	if err != nil {
		return Report{}, err
	}
	return report, nil
}

func importVault(app core.App, root string) (Report, error) {
	report := Report{}

	paths, timelineSkipped, walkWarnings, err := collectMarkdown(root)
	if err != nil {
		return report, err
	}
	report.TimelineSkipped = timelineSkipped
	report.Warnings = append(report.Warnings, walkWarnings...)
	report.FilesScanned = len(paths)

	unsafeApp := app.UnsafeWithoutHooks()

	files := make([]vaultFile, 0, len(paths))
	for _, relativePath := range paths {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relativePath)))
		if err != nil {
			report.SkippedFiles = append(report.SkippedFiles, relativePath)
			report.Warnings = append(report.Warnings, fmt.Sprintf("%s: %v", relativePath, err))
			continue
		}
		file, warnings, err := buildFile(relativePath, content)
		report.Warnings = append(report.Warnings, warnings...)
		if err != nil {
			report.SkippedFiles = append(report.SkippedFiles, relativePath)
			report.Warnings = append(report.Warnings, fmt.Sprintf("%s: %v", relativePath, err))
			continue
		}
		if file.unknownType != "" {
			report.UnknownTypes = append(report.UnknownTypes, fmt.Sprintf("%s: %s", relativePath, file.unknownType))
		}
		if file.unknownTemplate != "" {
			report.UnknownTemplates = append(report.UnknownTemplates, fmt.Sprintf("%s: %s", relativePath, file.unknownTemplate))
		}
		files = append(files, file)
	}

	creator := newCampaignCreator(app)
	if err := precreateFolderCampaigns(creator, root, &report); err != nil {
		return report, err
	}

	for index := range files {
		if files[index].scope == "rules" {
			files[index].campaignIDs = []string{}
			continue
		}
		seen := map[string]bool{}
		for _, ref := range files[index].campaignRefs {
			id, err := creator.ensure(ref.key, ref.name)
			if err != nil {
				return report, err
			}
			if !seen[id] {
				seen[id] = true
				files[index].campaignIDs = append(files[index].campaignIDs, id)
			}
		}
	}

	records := make(map[string]*core.Record, len(files))
	for index := range files {
		record, created, unchanged, err := upsertEntity(unsafeApp, &files[index])
		if err != nil {
			return report, err
		}
		records[files[index].relPath] = record
		switch {
		case created:
			report.EntitiesCreated++
		case unchanged:
			report.EntitiesUnchanged++
		default:
			report.EntitiesUpdated++
		}
	}

	resolver := world.NewResolver()
	seenNames := map[string]string{}
	for _, file := range files {
		record := records[file.relPath]
		if firstPath, duplicate := seenNames[file.name]; duplicate {
			report.DuplicateBasenames = append(report.DuplicateBasenames,
				fmt.Sprintf("%q: %q and %q (first wins)", file.name, firstPath, file.relPath))
			continue
		}
		seenNames[file.name] = file.relPath
		resolver.Add(file.name, record.Id)
		for _, alias := range aliasesToStrings(file.aliases) {
			resolver.Add(alias, record.Id)
		}
	}

	createdTypeKeys := map[string]bool{}
	for _, file := range files {
		record := records[file.relPath]

		relationResult, err := world.SyncEntityRelations(unsafeApp, record, resolver)
		if err != nil {
			return report, fmt.Errorf("%s: sync relations: %w", file.relPath, err)
		}
		report.Relations += relationResult.Count
		for _, key := range relationResult.CreatedTypeKeys {
			if !createdTypeKeys[key] {
				createdTypeKeys[key] = true
			}
		}
		for _, rename := range relationResult.Renames {
			report.RelationRenames = append(report.RelationRenames, fmt.Sprintf("%s: %s", file.relPath, rename))
		}
		for _, name := range relationResult.UnresolvedNames {
			report.UnresolvedRelations = append(report.UnresolvedRelations, fmt.Sprintf("%s: %s", file.relPath, name))
		}
		for _, warning := range relationResult.Warnings {
			report.Warnings = append(report.Warnings, fmt.Sprintf("%s: %s", file.relPath, warning))
		}

		mentionResult, err := world.SyncEntityMentions(unsafeApp, record, resolver)
		if err != nil {
			return report, fmt.Errorf("%s: sync mentions: %w", file.relPath, err)
		}
		report.Mentions += mentionResult.Count
		for _, name := range mentionResult.UnresolvedNames {
			report.UnresolvedMentions = append(report.UnresolvedMentions, fmt.Sprintf("%s: %s", file.relPath, name))
		}
		for _, warning := range mentionResult.Warnings {
			report.Warnings = append(report.Warnings, fmt.Sprintf("%s: %s", file.relPath, warning))
		}
	}

	report.CampaignsCreated = creator.created
	report.RelationTypesCreated = len(createdTypeKeys)
	report.UnknownTypes = sortedUnique(report.UnknownTypes)
	report.UnknownTemplates = sortedUnique(report.UnknownTemplates)
	report.DuplicateBasenames = sortedUnique(report.DuplicateBasenames)
	report.RelationRenames = sortedUnique(report.RelationRenames)
	report.UnresolvedRelations = sortedUnique(report.UnresolvedRelations)
	report.UnresolvedMentions = sortedUnique(report.UnresolvedMentions)
	report.SkippedFiles = sortedUnique(report.SkippedFiles)
	report.Warnings = sortedUnique(report.Warnings)
	return report, nil
}

func collectMarkdown(root string) (paths []string, timelineSkipped int, warnings []string, err error) {
	err = filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", filePath, walkErr))
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		relativePath, err := filepath.Rel(root, filePath)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", filePath, err))
			return nil
		}
		relativePath = filepath.ToSlash(relativePath)
		if entry.IsDir() {
			if entry.Name() == ".obsidian" || entry.Name() == ".trash" {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			return nil
		}
		if inTopLevelTimeline(relativePath) {
			timelineSkipped++
			return nil
		}
		paths = append(paths, relativePath)
		return nil
	})
	if err != nil {
		return nil, 0, warnings, err
	}
	sort.Strings(paths)
	return paths, timelineSkipped, warnings, nil
}

func inTopLevelTimeline(relativePath string) bool {
	segments := strings.Split(relativePath, "/")
	return len(segments) > 1 && strings.EqualFold(segments[0], "Timeline")
}

func buildFile(relativePath string, content []byte) (vaultFile, []string, error) {
	frontmatter, body, err := ParseFrontmatter(content)
	warnings := []string{}
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("%s: %v; imported with folder inference", relativePath, err))
		frontmatter = map[string]any{}
	}

	file := vaultFile{relPath: relativePath}
	file.folder = path.Dir(relativePath)
	if file.folder == "." {
		file.folder = ""
	}
	file.name = strings.TrimSuffix(path.Base(relativePath), path.Ext(relativePath))
	file.body = body
	file.scope = world.InferScope(file.folder)
	file.rawType = stringFromValue(frontmatter["type"])
	file.template = stringFromValue(frontmatter["template"])

	typeClass, known := world.NormalizeTypeClass(file.rawType)
	switch {
	case strings.TrimSpace(file.rawType) == "":
		typeClass = world.InferTypeClassFromFolder(file.folder)
	case !known:
		file.unknownType = file.rawType
		typeClass = world.InferTypeClassFromFolder(file.folder)
	}
	file.typeClass = typeClass

	if file.template != "" && !knownTemplates[strings.ToLower(strings.TrimSpace(file.template))] {
		file.unknownTemplate = file.template
	}

	file.data = frontmatter["data"]
	if file.data == nil {
		file.data = map[string]any{}
	}
	file.links = frontmatter["links"]
	if file.links == nil {
		file.links = map[string]any{}
	}
	file.meta = frontmatter["meta"]
	if file.meta == nil {
		file.meta = map[string]any{}
	}

	aliases, aliasWarnings := normalizeAliases(relativePath, frontmatter["aliases"])
	file.aliases = aliases
	warnings = append(warnings, aliasWarnings...)

	file.status = stringFromValue(frontmatter["status"])
	if strings.TrimSpace(file.status) == "" {
		if dataMap, ok := frontmatter["data"].(map[string]any); ok {
			if value, ok := dataMap["Status"].(string); ok {
				file.status = strings.TrimSpace(value)
			} else if value, ok := dataMap["status"].(string); ok {
				file.status = strings.TrimSpace(value)
			}
		}
	}

	file.eventDate = eventDateFromValue(frontmatter["date"])
	if file.eventDate == "" {
		file.eventDate = filenameDatePattern.FindString(file.name)
	}

	refs, explicit, campaignWarnings := campaignRefsFromFrontmatter(relativePath, frontmatter)
	warnings = append(warnings, campaignWarnings...)
	if file.scope == "rules" {
		file.campaignRefs = nil
	} else if explicit {
		file.campaignRefs = refs
	} else if key, name, ok := world.InferCampaignFromFolder(file.folder); ok {
		file.campaignRefs = []campaignRef{{key: key, name: name}}
	}

	sum := sha256.Sum256(content)
	file.hash = hex.EncodeToString(sum[:])
	return file, warnings, nil
}

func normalizeAliases(relativePath string, value any) ([]any, []string) {
	switch typed := value.(type) {
	case nil:
		return []any{}, nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return []any{}, nil
		}
		return []any{trimmed}, nil
	case []string:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result, nil
	case []any:
		result := make([]any, 0, len(typed))
		warnings := make([]string, 0)
		for _, item := range typed {
			alias, ok := item.(string)
			if !ok {
				warnings = append(warnings, fmt.Sprintf("%s: skipping non-string alias of type %T", relativePath, item))
				continue
			}
			trimmed := strings.TrimSpace(alias)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result, warnings
	default:
		return []any{}, []string{fmt.Sprintf("%s: aliases must be a list or string", relativePath)}
	}
}

func aliasesToStrings(aliases []any) []string {
	result := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		if value, ok := alias.(string); ok {
			result = append(result, value)
		}
	}
	return result
}

func campaignRefsFromFrontmatter(relativePath string, frontmatter map[string]any) ([]campaignRef, bool, []string) {
	value, exists := frontmatter["campaigns"]
	if !exists {
		return nil, false, nil
	}
	var warnings []string
	var refs []campaignRef
	add := func(raw string) {
		value := strings.TrimSpace(raw)
		if value == "" {
			return
		}
		key := world.Slugify(value)
		if key == "" {
			warnings = append(warnings, fmt.Sprintf("%s: campaign %q has no usable key", relativePath, value))
			return
		}
		name := value
		if strings.EqualFold(name, key) {
			name = humanizeKey(key)
		}
		refs = append(refs, campaignRef{key: key, name: name})
	}

	switch typed := value.(type) {
	case nil:
	case string:
		add(typed)
	case []string:
		for _, item := range typed {
			add(item)
		}
	case []any:
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				warnings = append(warnings, fmt.Sprintf("%s: skipping non-string campaign of type %T", relativePath, item))
				continue
			}
			add(text)
		}
	default:
		warnings = append(warnings, fmt.Sprintf("%s: campaigns must be a string or list", relativePath))
	}
	return refs, true, warnings
}

func stringFromValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case time.Time:
		return typed.Format("2006-01-02")
	case map[string]any, []any:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func eventDateFromValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case time.Time:
		return typed.Format("2006-01-02")
	case *time.Time:
		if typed == nil {
			return ""
		}
		return typed.Format("2006-01-02")
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

type campaignCreator struct {
	app     core.App
	created int
	byKey   map[string]string
}

func newCampaignCreator(app core.App) *campaignCreator {
	return &campaignCreator{app: app, byKey: map[string]string{}}
}

func (creator *campaignCreator) ensure(key, name string) (string, error) {
	if id, ok := creator.byKey[key]; ok {
		return id, nil
	}
	record, err := creator.app.FindFirstRecordByData("campaigns", "key", key)
	if err == nil {
		creator.byKey[key] = record.Id
		return record.Id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	collection, err := creator.app.FindCachedCollectionByNameOrId("campaigns")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(name) == "" {
		name = humanizeKey(key)
	}
	record = core.NewRecord(collection)
	record.Set("key", key)
	record.Set("name", name)
	if err := creator.app.Save(record); err != nil {
		return "", err
	}
	creator.created++
	creator.byKey[key] = record.Id
	return record.Id, nil
}

func precreateFolderCampaigns(creator *campaignCreator, root string, report *Report) error {
	entries, err := os.ReadDir(filepath.Join(root, "Campaigns"))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		report.Warnings = append(report.Warnings, fmt.Sprintf("Campaigns folder: %v", err))
		return nil
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		key := world.Slugify(name)
		if key == "" {
			continue
		}
		if _, err := creator.ensure(key, name); err != nil {
			return err
		}
	}
	return nil
}

func humanizeKey(key string) string {
	parts := strings.Split(key, "-")
	for index, part := range parts {
		if part == "" {
			continue
		}
		parts[index] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func upsertEntity(app core.App, file *vaultFile) (*core.Record, bool, bool, error) {
	record, err := app.FindFirstRecordByFilter("entities", "source_path = {:sourcePath}", dbx.Params{"sourcePath": file.relPath})
	exists := true
	if errors.Is(err, sql.ErrNoRows) {
		exists = false
		collection, collectionErr := app.FindCachedCollectionByNameOrId("entities")
		if collectionErr != nil {
			return nil, false, false, collectionErr
		}
		record = core.NewRecord(collection)
		record.Id = core.GenerateDefaultRandomId()
	} else if err != nil {
		return nil, false, false, err
	}

	if exists && record.GetString("source_hash") == file.hash {
		return record, false, true, nil
	}

	record.Set("name", file.name)
	record.Set("type_class", file.typeClass)
	record.Set("template", file.template)
	record.Set("source_type", file.rawType)
	record.Set("status", file.status)
	record.Set("folder", file.folder)
	record.Set("event_date", file.eventDate)
	record.Set("data", file.data)
	record.Set("links", file.links)
	record.Set("meta", file.meta)
	record.Set("aliases", file.aliases)
	record.Set("body", file.body)
	record.Set("campaigns", file.campaignIDs)
	record.Set("scope", file.scope)
	record.Set("system", "")
	record.Set("source_path", file.relPath)
	record.Set("source_hash", file.hash)
	if err := app.Save(record); err != nil {
		return nil, false, false, fmt.Errorf("%s: save entity: %w", file.relPath, err)
	}
	return record, !exists, false, nil
}

func sortedUnique(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
