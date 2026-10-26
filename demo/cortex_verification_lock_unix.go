//go:build darwin || linux

package main

import (
	"context"
	"errors"
	"os"
	"syscall"
	"time"
)

func openCortexVerificationFile(name string, flags int) (*os.File, error) {
	fd, err := syscall.Open(name, (flags&^syscall.O_TRUNC)|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), name)
	var stat syscall.Stat_t
	if err = syscall.Fstat(fd, &stat); err != nil || stat.Mode&syscall.S_IFMT != syscall.S_IFREG || stat.Mode&0o777 != 0o600 || int64(stat.Uid) != int64(os.Getuid()) || stat.Nlink != 1 {
		return nil, errors.Join(errors.New("verification authority file is not private and regular"), f.Close())
	}
	if flags&syscall.O_TRUNC != 0 {
		if err = f.Truncate(0); err != nil {
			return nil, errors.Join(err, f.Close())
		}
	}
	return f, nil
}

func lockCortexVerification(ctx context.Context, name string, exclusive bool) (func() error, error) {
	f, err := openCortexVerificationFile(name, os.O_CREATE|os.O_RDWR)
	if err != nil {
		return nil, err
	}
	mode := syscall.LOCK_SH
	if exclusive {
		mode = syscall.LOCK_EX
	}
	for {
		if err = ctx.Err(); err != nil {
			return nil, errors.Join(err, f.Close())
		}
		err = syscall.Flock(int(f.Fd()), mode|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) {
			return nil, errors.Join(err, f.Close())
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
	return func() error { return errors.Join(syscall.Flock(int(f.Fd()), syscall.LOCK_UN), f.Close()) }, nil
}

func validateCortexVerificationDirectory(name string) error {
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() || info.Mode().Perm()&0o022 != 0 || int64(stat.Uid) != int64(os.Getuid()) {
		return errors.New("verification authority directory must be owned and private to writes")
	}
	return nil
}
