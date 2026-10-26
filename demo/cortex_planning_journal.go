package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/xraph/cortex/evidence"
)

// Team inputs are private host records. A partial write blocks reuse and never
// falls back to another request identity.
func cortexPlanningRecord[T any](ctx context.Context, directory, name string, create func() (T, error)) (value T, resultErr error) {
	unlock, err := lockCortexVerification(ctx, filepath.Join(directory, name+".lock"), true)
	if err != nil {
		return value, err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	path := filepath.Join(directory, name+".json")
	file, err := openCortexVerificationFile(path, os.O_RDONLY)
	if err == nil {
		body, readErr := io.ReadAll(io.LimitReader(file, (4<<20)+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil {
			return value, errors.Join(readErr, closeErr)
		}
		if len(body) > 4<<20 {
			return value, evidence.ErrTooLarge
		}
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&value); decodeErr != nil {
			return value, decodeErr
		}
		var tail any
		if err = decoder.Decode(&tail); !errors.Is(err, io.EOF) {
			return value, evidence.ErrInvalid
		}
		return value, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return value, err
	}
	value, err = create()
	if err != nil {
		return value, err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return value, err
	}
	if len(body) > 4<<20 {
		return value, evidence.ErrTooLarge
	}
	file, err = openCortexVerificationFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return value, err
	}
	n, writeErr := file.Write(body)
	if writeErr == nil && n != len(body) {
		writeErr = io.ErrShortWrite
	}
	syncErr := file.Sync()
	closeErr := file.Close()
	if persistErr := errors.Join(writeErr, syncErr, closeErr); persistErr != nil {
		return value, persistErr
	}
	// #nosec G703 -- directory is the owner-validated private host journal, never a request path.
	dir, err := os.Open(directory)
	if err != nil {
		return value, err
	}
	return value, errors.Join(dir.Sync(), dir.Close())
}
