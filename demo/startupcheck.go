package main

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"strings"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"
)

// registerCapabilitiesShapeCheck warns when the compiled transport cannot report
// contributor readiness. It inspects the actual binary, not a sibling checkout.
func registerCapabilitiesShapeCheck(app forge.App) {
	_ = forge.OnBeforeRun(app, "demo-capabilities-shape-check", func(_ context.Context, _ forge.App) error {
		checkConfiguredFieldPresent()
		return nil // advisory only: never block startup over this
	})
}

func checkConfiguredFieldPresent() {
	b, err := json.Marshal(transport.ContributorCapability{})
	if err != nil {
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil {
		return
	}
	if _, ok := fields["configured"]; ok {
		return // present: nothing to warn about
	}

	fmt.Println()
	fmt.Println(strings.Repeat("!", 78))
	fmt.Printf("[demo] Forge %s has no configured capability field.\n", compiledForgeVersion())
	fmt.Println(`[demo] Contributors will appear in the shell's "setup" state.`)
	fmt.Println("[demo] Rebuild with the published dependencies pinned in demo/go.mod.")
	fmt.Println(strings.Repeat("!", 78))
	fmt.Println()
}

func compiledForgeVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "(build information unavailable)"
	}
	for _, dependency := range info.Deps {
		if dependency.Path == "github.com/xraph/forge" {
			if dependency.Replace != nil {
				return dependency.Version + " (replaced by " + dependency.Replace.Path + " " + dependency.Replace.Version + ")"
			}
			return dependency.Version
		}
	}
	return "(version unavailable)"
}
