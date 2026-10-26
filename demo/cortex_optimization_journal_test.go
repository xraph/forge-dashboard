package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	opt "github.com/xraph/cortex/optimization"
)

func TestCortexOptimizationJournalRestartAndConflict(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "journal")
	j, err := openCortexOptimizationJournal(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	first, err := j.put("dispatch", "attempt", struct{ Digest string }{"original"})
	if err != nil || !first {
		t.Fatal(first, err)
	}
	if err = j.close(); err != nil {
		t.Fatal(err)
	}
	j, err = openCortexOptimizationJournal(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	defer j.close()
	first, err = j.put("dispatch", "attempt", struct{ Digest string }{"original"})
	if err != nil || first {
		t.Fatal("restart dispatched again", first, err)
	}
	if _, err = j.put("dispatch", "attempt", struct{ Digest string }{"changed"}); !errors.Is(err, opt.ErrConflict) {
		t.Fatal("changed retry accepted", err)
	}
	var result struct{ Digest string }
	if err = j.read("result", "attempt", &result); !errors.Is(err, opt.ErrNotFound) {
		t.Fatal(err)
	}
	if err = os.Chmod(filepath.Join(directory, cortexOptimizationJournalName("dispatch", "attempt")), 0644); err != nil {
		t.Fatal(err)
	}
	if err = j.read("dispatch", "attempt", &result); err == nil {
		t.Fatal("public journal entry accepted")
	}
}
