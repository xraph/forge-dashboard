//go:build !darwin && !linux

package main

import (
	"context"
	"errors"
	"os"
)

func openCortexVerificationFile(string, int) (*os.File, error) {
	return nil, errors.New("verified local demo requires Darwin or Linux file locking")
}
func lockCortexVerification(context.Context, string, bool) (func() error, error) {
	return nil, errors.New("verified local demo requires Darwin or Linux file locking")
}

func validateCortexVerificationDirectory(string) error {
	return errors.New("verification authority locking unsupported on this platform")
}
