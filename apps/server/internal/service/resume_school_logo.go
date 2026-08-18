package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image/png"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
	"github.com/vega-resume/server/internal/repository"
)

const (
	SchoolLogoHeight   = 500
	SchoolLogoWidth    = 500
	MaxSchoolLogoBytes = 512 * 1024
)

func (s *ResumeService) PutSchoolLogo(ctx context.Context, userID, resumeID uuid.UUID, data []byte) (*model.Resume, error) {
	if err := validateSchoolLogo(data); err != nil {
		return nil, err
	}
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	key := filepath.ToSlash(filepath.Join(userID.String(), resumeID.String()+"-school-logo.png"))
	if err := s.avatars.Write(key, data); err != nil {
		return nil, model.ErrInternalServer
	}
	if err := s.resumes.SetResumeSchoolLogo(ctx, userID, resumeID, &key); errors.Is(err, repository.ErrNotFound) {
		_ = s.avatars.Delete(key)
		return nil, model.ErrResumeNotFound
	} else if err != nil {
		_ = s.avatars.Delete(key)
		return nil, model.ErrDBError
	}
	if resume.SchoolLogoKey != nil && *resume.SchoolLogoKey != key {
		_ = s.avatars.Delete(*resume.SchoolLogoKey)
	}
	return s.Get(ctx, userID, resumeID)
}

func (s *ResumeService) GetSchoolLogo(ctx context.Context, userID, resumeID uuid.UUID) ([]byte, error) {
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	if resume.SchoolLogoKey == nil {
		return nil, model.ErrResumeNotFound
	}
	data, err := s.avatars.Read(*resume.SchoolLogoKey)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, model.ErrResumeNotFound
		}
		return nil, model.ErrInternalServer
	}
	return data, nil
}

func (s *ResumeService) DeleteSchoolLogo(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	if err := s.resumes.SetResumeSchoolLogo(ctx, userID, resumeID, nil); errors.Is(err, repository.ErrNotFound) {
		return nil, model.ErrResumeNotFound
	} else if err != nil {
		return nil, model.ErrDBError
	}
	if resume.SchoolLogoKey != nil {
		_ = s.avatars.Delete(*resume.SchoolLogoKey)
	}
	return s.Get(ctx, userID, resumeID)
}

func DecodeSchoolLogoDataURL(value string) ([]byte, error) {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(value, prefix) {
		return nil, model.ErrSchoolLogoInvalid
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return nil, model.ErrSchoolLogoInvalid
	}
	if err := validateSchoolLogo(data); err != nil {
		return nil, err
	}
	return data, nil
}

func validateSchoolLogo(data []byte) error {
	if len(data) == 0 || len(data) > MaxSchoolLogoBytes {
		return model.ErrFileTooLarge
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != SchoolLogoWidth || config.Height != SchoolLogoHeight {
		return model.ErrSchoolLogoInvalid
	}
	return nil
}
