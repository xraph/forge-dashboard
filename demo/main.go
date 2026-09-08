// Command demo runs a standalone Forge application that registers the real
// dashboard extension (github.com/xraph/forge/extensions/dashboard) plus two
// synthetic contract contributors, so forge-dashboard's React shell can be
// developed against a genuine Go contract transport without a checkout of
// the forge repo being the running application.
//
// See README.md for what this serves and how to point the shell at it.
package main

import (
	"log"
	"os"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard"
)

// defaultPort matches what apps/shell/vite.config.ts and the playground
// proxy /dashboard to. Override with the PORT environment variable.
const defaultPort = "8099"

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	app := forge.New(
		forge.WithAppName("forge-dashboard-demo"),
		forge.WithAppVersion("0.1.0"),
		forge.WithHTTPAddress(":"+port),
	)

	dashExt := dashboard.NewExtension(
		dashboard.WithTitle("Forge Dashboard Demo"),
		dashboard.WithBasePath("/dashboard"),
		dashboard.WithRealtime(true),
		// The demo's whole point is to be easy to curl and to click through
		// without a CSRF/idempotency handshake getting in the way first.
		// Real deployments should leave this at its default (true).
		dashboard.WithContractSecurity(false),
	)
	if err := app.RegisterExtension(dashExt); err != nil {
		log.Fatalf("register dashboard extension: %v", err)
	}

	// These two are auto-discovered by the dashboard extension during its
	// Start() (see extensions/dashboard/aware.go: ContractContributorAware)
	// purely because they implement RegisterContractContributor -- no
	// manual wiring against dashExt is needed here.
	if err := app.RegisterExtension(NewStreamingContributorExtension()); err != nil {
		log.Fatalf("register streaming-contract contributor: %v", err)
	}
	if err := app.RegisterExtension(NewAuthContributorExtension()); err != nil {
		log.Fatalf("register auth contributor: %v", err)
	}

	// See startupcheck.go and README.md's "Which forge checkout you need":
	// the go.mod replace directive points at ../../forge on disk with no
	// version pin, so whether the shell can ever see "ready" for these
	// contributors depends on which branch that checkout happens to be on.
	// This makes a missing "configured" field loud instead of silent.
	registerCapabilitiesShapeCheck(app)

	log.Printf("forge-dashboard demo starting on :%s (dashboard at /dashboard, contract at /dashboard/api/dashboard/v1)", port)
	if err := app.Run(); err != nil {
		log.Fatalf("application error: %v", err)
	}
}
