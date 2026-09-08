package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"
)

// requiredForgeBranch names the earliest forge branch confirmed to carry
// the ContributorCapability.Configured field this demo, and
// forge-dashboard's shell, depend on. It is absent from main and from the
// v1.11.0 tag. See the "Which forge checkout you need" section of
// README.md for the full story of how that was found.
const requiredForgeBranch = "fix/dashboard-collector-rss"

// registerCapabilitiesShapeCheck installs a BeforeRun hook (runs after the
// startup banner, right before the HTTP server starts listening) that
// checks, in process, whether the forge checkout this binary was actually
// compiled against has the "configured" field on
// transport.ContributorCapability.
//
// It never makes an HTTP call and never depends on which contributors are
// registered: it marshals a zero-value struct and inspects the resulting
// JSON keys, which is enough to tell whether the field exists in the
// compiled code at all.
//
// This exists because go.mod's replace directive points at ../../forge on
// disk with no version pin, so this demo's behaviour silently changes with
// whatever branch that checkout happens to be sitting on, including
// branches left there by unrelated work in another session. A missing
// field degrades the shell without producing an error of its own (every
// contributor just reads as "setup" forever), so this check exists to turn
// that into a loud, specific message instead of a silent one.
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

	branch := currentForgeBranch()
	fmt.Println()
	fmt.Println(strings.Repeat("!", 78))
	fmt.Println("[demo] STARTUP CHECK FAILED: forge's ContributorCapability has no")
	fmt.Println(`[demo] "configured" field in the checkout this binary was built against.`)
	fmt.Printf("[demo] That checkout (../../forge, via the go.mod replace directive) is\n")
	fmt.Printf("[demo] currently on branch %q.\n", branch)
	fmt.Println("[demo]")
	fmt.Println("[demo] This demo, and forge-dashboard's shell, need forge at commit")
	fmt.Printf("[demo] %s or later. The field is absent from main\n", requiredForgeBranch)
	fmt.Println("[demo] and from the v1.11.0 tag.")
	fmt.Println("[demo]")
	fmt.Println(`[demo] Effect: every contributor this server reports will resolve to the`)
	fmt.Println(`[demo] shell's "setup" state, never "ready", no matter what DEMO_* env`)
	fmt.Println(`[demo] vars you set. See README.md, section "Which forge checkout you`)
	fmt.Println(`[demo] need".`)
	fmt.Println(strings.Repeat("!", 78))
	fmt.Println()
}

// currentForgeBranch best-effort shells out to git to name the branch the
// replaced forge checkout is on. It returns a placeholder instead of an
// error if that fails for any reason (no git on PATH, path moved, not a
// checkout at all): this is a diagnostic aid, not something worth crashing
// a demo server over.
func currentForgeBranch() string {
	out, err := exec.Command("git", "-C", "../../forge", "branch", "--show-current").Output()
	if err != nil {
		return fmt.Sprintf("<unknown: git lookup failed: %v>", err)
	}
	branch := strings.TrimSpace(string(out))
	if branch == "" {
		return "<detached HEAD or unknown>"
	}
	return branch
}
