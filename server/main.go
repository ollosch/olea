package main

import (
	"embed"
	"encoding/json"
	"fmt"
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
	"olea/dnd5eimport"
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
	app.RootCmd.AddCommand(&cobra.Command{
		Use:   "dnd5e-import spells <json-file>",
		Short: "Import a local D&D 5e spell source file",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if args[0] != "spells" {
				return fmt.Errorf("unsupported D&D 5e import kind %q", args[0])
			}
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
			parsed, err := dnd5eimport.ParseSpells(file)
			if err != nil {
				return err
			}
			imported, err := catalogimport.Import(app, "dnd5e", parsed.Document)
			if err != nil {
				return err
			}
			return json.NewEncoder(cmd.OutOrStdout()).Encode(struct {
				Created  int      `json:"created"`
				Updated  int      `json:"updated"`
				Skipped  int      `json:"skipped"`
				Warnings []string `json:"warnings"`
			}{imported.Created, imported.Updated, parsed.Skipped, parsed.Warnings})
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
