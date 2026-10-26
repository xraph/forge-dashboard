package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"

	opt "github.com/xraph/cortex/optimization"
)

// Journal entries are immutable. A dispatch marker without a result remains
// uncertain across restart, so reconnecting cannot replay the provider call.
type cortexOptimizationJournal struct {
	mu        sync.Mutex
	root      *os.Root
	directory string
	identity  os.FileInfo
	unlock    func() error
}

func openCortexOptimizationJournal(ctx context.Context, directory string) (*cortexOptimizationJournal, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	if err := validateCortexVerificationDirectory(directory); err != nil {
		return nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil || info.Mode().Perm() != 0o700 {
		return nil, opt.ErrUnavailable
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	unlock, err := lockCortexVerification(ctx, filepath.Join(directory, "owner.lock"), true)
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	return &cortexOptimizationJournal{root: root, directory: directory, identity: info, unlock: unlock}, nil
}
func (j *cortexOptimizationJournal) close() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.root == nil {
		return nil
	}
	err := errors.Join(j.root.Close(), j.unlock())
	j.root = nil
	return err
}
func (j *cortexOptimizationJournal) check() error {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.checkLocked()
}
func (j *cortexOptimizationJournal) checkLocked() error {
	if j.root == nil {
		return opt.ErrUnavailable
	}
	info, err := os.Lstat(j.directory)
	if err != nil || !os.SameFile(j.identity, info) || info.Mode().Perm() != 0o700 {
		return opt.ErrUnavailable
	}
	return nil
}
func cortexOptimizationDigest(value any) (digest string, body []byte, err error) {
	body, err = json.Marshal(value)
	if err != nil || len(body) > 4<<20 {
		return "", nil, opt.ErrInvalidSpec
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), body, nil
}
func cortexOptimizationJournalName(kind, key string) string {
	sum := sha256.Sum256([]byte(kind + "\x00" + key))
	return hex.EncodeToString(sum[:]) + ".json"
}
func (j *cortexOptimizationJournal) read(kind, key string, destination any) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.readLocked(cortexOptimizationJournalName(kind, key), destination)
}
func (j *cortexOptimizationJournal) readLocked(name string, destination any) error {
	if err := j.checkLocked(); err != nil {
		return err
	}
	info, err := j.root.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return opt.ErrNotFound
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || info.Size() > 4<<20 {
		return opt.ErrUnavailable
	}
	f, err := j.root.Open(name)
	if err != nil {
		return opt.ErrUnavailable
	}
	body, readErr := io.ReadAll(io.LimitReader(f, (4<<20)+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || len(body) > 4<<20 {
		return opt.ErrUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(destination) != nil {
		return opt.ErrIncompleteEvidence
	}
	var extra any
	if !errors.Is(decoder.Decode(&extra), io.EOF) {
		return opt.ErrIncompleteEvidence
	}
	_, canonical, err := cortexOptimizationDigest(destination)
	if err != nil || !bytes.Equal(canonical, body) {
		return opt.ErrIncompleteEvidence
	}
	return j.checkLocked()
}
func (j *cortexOptimizationJournal) put(kind, key string, value any) (bool, error) {
	_, body, err := cortexOptimizationDigest(value)
	if err != nil {
		return false, err
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if operationErr := j.checkLocked(); operationErr != nil {
		return false, operationErr
	}
	name := cortexOptimizationJournalName(kind, key)
	f, err := j.root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) {
		var old json.RawMessage
		if operationErr := j.readLocked(name, &old); operationErr != nil {
			return false, operationErr
		}
		if !bytes.Equal(old, body) {
			return false, opt.ErrConflict
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, writeErr := f.Write(body)
	syncErr := f.Sync()
	closeErr := f.Close()
	if operationErr := errors.Join(writeErr, syncErr, closeErr); operationErr != nil {
		return false, operationErr
	}
	dir, err := j.root.Open(".")
	if err != nil {
		return false, err
	}
	if operationErr := errors.Join(dir.Sync(), dir.Close()); operationErr != nil {
		return false, operationErr
	}
	return true, j.checkLocked()
}
