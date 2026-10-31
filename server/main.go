package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/spf13/cobra"

	"olea/catalogimport"
	_ "olea/migrations"
)

// The placeholder keeps Go builds valid before the frontend is built.
//
//go:embed all:ui
var frontend embed.FS

func main() {
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "serve", "--http=0.0.0.0:8090")
	}

	app := pocketbase.New()
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{})
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "catalog-import <system-key> <json-file>",
		Short: "Import a local catalog JSON document",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := app.RunAppMigrations(); err != nil {
				return err
			}
			path, err := filepath.Abs(args[1])
			if err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()
			document, err := catalogimport.Parse(file)
			if err != nil {
				return err
			}
			summary, err := catalogimport.Import(app, args[0], document)
			if err != nil {
				return err
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(summary)
		},
	})
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		public, err := fs.Sub(frontend, "ui/dist")
		if err != nil {
			return err
		}
		if _, err := fs.Stat(public, "index.html"); err != nil {
			log.Fatal("Frontend not built: run npm install and npm run build before building the server")
		}
		e.Router.GET("/{path...}", apis.Static(public, true))
		return e.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
