package main

import (
	"embed"
	"io/fs"
	"log"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	_ "olea/migrations"
)

// The placeholder keeps Go builds valid before the frontend is built.
//go:embed all:ui
var frontend embed.FS

func main() {
	if len(os.Args) == 1 {
		os.Args = append(os.Args, "serve", "--http=0.0.0.0:8090")
	}

	app := pocketbase.New()
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{})
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
