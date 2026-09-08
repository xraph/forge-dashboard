package main

import (
	"os"
	"strconv"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

// envBool reads a boolean environment variable, defaulting when unset or
// unparsable.
func envBool(name string, def bool) bool {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// demoOmit reports whether DEMO_<PREFIX>_OMIT is set, meaning the
// contributor should not be registered with the contract registry at all --
// it will not appear in GET .../capabilities, and forge-dashboard's shell
// resolves the matching plugin to its "hidden" state (see
// packages/plugin/src/resolve.ts).
func demoOmit(prefix string) bool {
	return envBool("DEMO_"+prefix+"_OMIT", false)
}

// demoUnavailableFlag reports whether DEMO_<PREFIX>_UNAVAILABLE is set.
func demoUnavailableFlag(prefix string) bool {
	return envBool("DEMO_"+prefix+"_UNAVAILABLE", false)
}

// demoUnavailable returns a contract.CodeUnavailable error when
// DEMO_<PREFIX>_UNAVAILABLE is set, for every intent handler in that
// contributor to check first. The contributor still appears in capabilities
// (unlike demoOmit) -- its manifest and intents are registered normally --
// but every query/command fails, which is what a "we know about this
// contributor, but it isn't working right now" state looks like at the
// contract layer.
//
// This is the closest the genuine forge contract transport can get to a
// "not configured" signal today: see the "configured" field discrepancy
// noted in demo/README.md. It is not the same thing -- this fails per
// request rather than reporting readiness up front -- but it exercises a
// real non-ready path in the shell (QueryView's error card) using nothing
// but the real dispatcher and real error codes.
func demoUnavailable(prefix string) error {
	if !demoUnavailableFlag(prefix) {
		return nil
	}
	return &contract.Error{
		Code:    contract.CodeUnavailable,
		Message: "demo: DEMO_" + prefix + "_UNAVAILABLE is set",
	}
}
