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
	"github.com/xraph/forge/extensions/streaming"
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

	// Both contributors below are auto-discovered by the dashboard extension
	// during its Start() (see extensions/dashboard/aware.go:
	// ContractContributorAware) purely because they implement
	// RegisterContractContributor -- no manual wiring against dashExt is
	// needed here.
	//
	// Real extensions are the default. DEMO_SYNTHETIC=true switches both
	// back to the hand-written contributors in streaming.go/auth.go -- the
	// only thing that still works if a real extension can't be built or
	// started. Per-contributor, DEMO_<PREFIX>_OMIT / DEMO_<PREFIX>_UNAVAILABLE
	// also fall back to the synthetic contributor even when DEMO_SYNTHETIC
	// isn't set: a real extension that's actually running has no "I'm not
	// registered" or "I'm registered but broken" mode to trigger, so those
	// two states can only come from the fixture. See README.md.
	synthetic := demoSynthetic()

	if synthetic || demoOmit("STREAMING") || demoUnavailableFlag("STREAMING") {
		if err := app.RegisterExtension(NewStreamingContributorExtension()); err != nil {
			log.Fatalf("register streaming-contract contributor (synthetic): %v", err)
		}
	} else if ok, detail := checkRealStreamingManifest(); !ok && !envBool("DEMO_STREAMING_FORCE_REAL", false) {
		// See streamingcheck.go: the real streaming extension's own bundled
		// manifest.yaml fails the dashboard's own contract validator (a
		// genuine, pre-existing defect, not something this demo caused), so
		// registering it for real would leave streaming-contract silently
		// missing from /capabilities. Fall back to the synthetic contributor
		// so the shell still has a working streaming scope, and say why.
		warnRealStreamingManifestInvalid(detail)
		if err := app.RegisterExtension(NewStreamingContributorExtension()); err != nil {
			log.Fatalf("register streaming-contract contributor (synthetic fallback): %v", err)
		}
	} else {
		if err := app.RegisterExtension(streaming.NewExtension()); err != nil {
			log.Fatalf("register streaming-contract contributor (real): %v", err)
		}
	}

	switch {
	case synthetic || demoOmit("AUTH") || demoUnavailableFlag("AUTH"):
		if err := app.RegisterExtension(NewAuthContributorExtension()); err != nil {
			log.Fatalf("register auth contributor (synthetic): %v", err)
		}
	default:
		authExt, err := newRealAuthsomeExtension()
		if err != nil {
			log.Printf("[demo] real authsome contributor unavailable, falling back to synthetic: %v", err)
			if err := app.RegisterExtension(NewAuthContributorExtension()); err != nil {
				log.Fatalf("register auth contributor (synthetic fallback): %v", err)
			}
		} else if err := app.RegisterExtension(authExt); err != nil {
			log.Fatalf("register auth contributor (real): %v", err)
		}
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
