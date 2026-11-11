package world

import (
	"path/filepath"
)

// AssetsURLPrefix is the public URL prefix for imported vault assets.
const AssetsURLPrefix = "/olea/assets/"

// AssetsDir returns the directory where imported vault assets are stored.
func AssetsDir(dataDir string) string {
	return filepath.Join(dataDir, "olea-assets")
}
