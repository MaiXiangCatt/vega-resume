package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image/jpeg"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
	"github.com/vega-resume/server/internal/repository"
)

const (
	AvatarHeight   = 700
	AvatarWidth    = 500
	MaxAvatarBytes = 512 * 1024
)

type AvatarStorage struct {
	dir string
}

func NewAvatarStorage(dir string) *AvatarStorage {
	if strings.TrimSpace(dir) == "" {
		dir = filepath.Join(os.TempDir(), "vega-resume-avatars")
	}
	return &AvatarStorage{dir: dir}
}

func (storage *AvatarStorage) Write(key string, data []byte) error {
	path := filepath.Join(storage.dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".avatar-*.jpg")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err == nil {
		return nil
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func (storage *AvatarStorage) Read(key string) ([]byte, error) {
	return os.ReadFile(filepath.Join(storage.dir, filepath.FromSlash(key)))
}

func (storage *AvatarStorage) Delete(key string) error {
	err := os.Remove(filepath.Join(storage.dir, filepath.FromSlash(key)))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (s *ResumeService) PutAvatar(ctx context.Context, userID, resumeID uuid.UUID, data []byte) (*model.Resume, error) {
	if err := validateAvatar(data); err != nil {
		return nil, err
	}
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	key := filepath.ToSlash(filepath.Join(userID.String(), resumeID.String()+".jpg"))
	if err := s.avatars.Write(key, data); err != nil {
		return nil, model.ErrInternalServer
	}
	if err := s.resumes.SetResumeAvatar(ctx, userID, resumeID, &key); errors.Is(err, repository.ErrNotFound) {
		_ = s.avatars.Delete(key)
		return nil, model.ErrResumeNotFound
	} else if err != nil {
		_ = s.avatars.Delete(key)
		return nil, model.ErrDBError
	}
	if resume.AvatarKey != nil && *resume.AvatarKey != key {
		_ = s.avatars.Delete(*resume.AvatarKey)
	}
	return s.Get(ctx, userID, resumeID)
}

func (s *ResumeService) GetAvatar(ctx context.Context, userID, resumeID uuid.UUID) ([]byte, error) {
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	if resume.AvatarKey == nil {
		return nil, model.ErrResumeNotFound
	}
	data, err := s.avatars.Read(*resume.AvatarKey)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, model.ErrResumeNotFound
		}
		return nil, model.ErrInternalServer
	}
	return data, nil
}

func (s *ResumeService) DeleteAvatar(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	if err := s.resumes.SetResumeAvatar(ctx, userID, resumeID, nil); errors.Is(err, repository.ErrNotFound) {
		return nil, model.ErrResumeNotFound
	} else if err != nil {
		return nil, model.ErrDBError
	}
	if resume.AvatarKey != nil {
		_ = s.avatars.Delete(*resume.AvatarKey)
	}
	return s.Get(ctx, userID, resumeID)
}

func DecodeAvatarDataURL(value string) ([]byte, error) {
	const prefix = "data:image/jpeg;base64,"
	if !strings.HasPrefix(value, prefix) {
		return nil, model.ErrAvatarInvalid
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return nil, model.ErrAvatarInvalid
	}
	if err := validateAvatar(data); err != nil {
		return nil, err
	}
	return data, nil
}

func validateAvatar(data []byte) error {
	if len(data) == 0 || len(data) > MaxAvatarBytes {
		return model.ErrFileTooLarge
	}
	config, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != AvatarWidth || config.Height != AvatarHeight {
		return model.ErrAvatarInvalid
	}
	return nil
}
