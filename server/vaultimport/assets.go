package vaultimport

import (
	"crypto/sha1"
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

	"olea/world"
)

var imageExtensions = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".gif":  true,
	".webp": true,
	".svg":  true,
	".bmp":  true,
	".avif": true,
}

var (
	assetLinkPattern    = regexp.MustCompile(`(!?)\[\[([^\]\n]+)\]\]`)
	sizeOnlyAltPattern  = regexp.MustCompile(`^\d+(?:x\d+)?$`)
	unsafeFilenameChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	multipleDashPattern = regexp.MustCompile(`-{2,}`)
)

type assetIndex struct {
	root       string
	dir        string
	byBasename map[string]string
}

type assetRewriteResult struct {
	Body    string
	Copied  int
	Missing []string
}

func newAssetIndex(root, dataDir string) (*assetIndex, []string, error) {
	index := &assetIndex{
		root:       root,
		dir:        world.AssetsDir(dataDir),
		byBasename: map[string]string{},
	}
	var files []string
	var warnings []string
	err := filepath.WalkDir(root, func(filePath string, entry fs.DirEntry, walkErr error) error {
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
		if inTopLevelTimeline(relativePath) {
			return nil
		}
		if !imageExtensions[strings.ToLower(filepath.Ext(entry.Name()))] {
			return nil
		}
		files = append(files, filePath)
		return nil
	})
	if err != nil {
		return nil, warnings, err
	}
	sort.Strings(files)
	for _, filePath := range files {
		relativePath, err := filepath.Rel(root, filePath)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", filePath, err))
			continue
		}
		base := filepath.Base(filePath)
		key := strings.ToLower(base)
		if existing, ok := index.byBasename[key]; ok {
			existingRelative, _ := filepath.Rel(root, existing)
			warnings = append(warnings, fmt.Sprintf("%q: %q and %q (first wins)", base, filepath.ToSlash(existingRelative), filepath.ToSlash(relativePath)))
			continue
		}
		index.byBasename[key] = filePath
	}
	return index, warnings, nil
}

func (index *assetIndex) copyTarget(target string) (filename string, found bool, copied bool, err error) {
	cleaned := cleanAssetTarget(target)
	if cleaned == "" || isURL(cleaned) {
		return "", false, false, nil
	}
	source, ok := index.byBasename[strings.ToLower(assetBasename(cleaned))]
	if !ok {
		return "", false, false, nil
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return "", false, false, err
	}
	sum := sha1.Sum(data)
	hash := hex.EncodeToString(sum[:])[:12]
	filename = hash + "-" + sanitizeAssetFilename(filepath.Base(source))
	destination := filepath.Join(index.dir, filename)
	if _, statErr := os.Stat(destination); statErr == nil {
		return filename, true, false, nil
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		return "", false, false, statErr
	}
	if err := os.MkdirAll(index.dir, 0o755); err != nil {
		return "", false, false, err
	}
	if err := os.WriteFile(destination, data, 0o644); err != nil {
		return "", false, false, err
	}
	return filename, true, true, nil
}

func (index *assetIndex) rewriteBody(relativePath, body string) (assetRewriteResult, error) {
	result := assetRewriteResult{Body: body}
	var replacementErr error
	result.Body = assetLinkPattern.ReplaceAllStringFunc(body, func(match string) string {
		if replacementErr != nil {
			return match
		}
		parts := assetLinkPattern.FindStringSubmatch(match)
		if parts == nil {
			return match
		}
		embed := parts[1] == "!"
		inner := parts[2]
		targetPart := inner
		altPart := ""
		if index := strings.Index(inner, "|"); index >= 0 {
			targetPart = inner[:index]
			altPart = strings.TrimSpace(inner[index+1:])
		}
		target := cleanAssetTarget(targetPart)
		if target == "" || isURL(target) || !isImageTarget(target) {
			return match
		}
		filename, found, copied, err := index.copyTarget(target)
		if err != nil {
			replacementErr = err
			return match
		}
		if !found {
			result.Missing = append(result.Missing, fmt.Sprintf("%s: %s", relativePath, target))
			return match
		}
		if copied {
			result.Copied++
		}
		alt := altPart
		if alt == "" || sizeOnlyAltPattern.MatchString(alt) {
			alt = assetBasename(target)
		}
		url := world.AssetsURLPrefix + filename
		if embed {
			return "![" + alt + "](" + url + ")"
		}
		return "[" + alt + "](" + url + ")"
	})
	if replacementErr != nil {
		return result, replacementErr
	}
	return result, nil
}

func cleanAssetTarget(target string) string {
	target = strings.TrimSpace(target)
	target = strings.ReplaceAll(target, "\\", "/")
	if index := strings.IndexAny(target, "#^"); index >= 0 {
		target = target[:index]
	}
	return strings.TrimSpace(target)
}

func assetBasename(target string) string {
	return path.Base(cleanAssetTarget(target))
}

func isImageTarget(target string) bool {
	return imageExtensions[strings.ToLower(path.Ext(assetBasename(target)))]
}

func isURL(target string) bool {
	lower := strings.ToLower(strings.TrimSpace(target))
	return strings.Contains(lower, "://") || strings.HasPrefix(lower, "mailto:") || strings.HasPrefix(lower, "data:")
}

func sanitizeAssetFilename(name string) string {
	extension := filepath.Ext(name)
	stem := strings.TrimSuffix(name, extension)
	stem = unsafeFilenameChars.ReplaceAllString(stem, "-")
	stem = multipleDashPattern.ReplaceAllString(stem, "-")
	stem = strings.Trim(stem, "-._")
	if stem == "" {
		stem = "asset"
	}
	extension = unsafeFilenameChars.ReplaceAllString(extension, "-")
	return stem + extension
}
