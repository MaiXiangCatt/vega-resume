package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
	"github.com/vega-resume/server/internal/repository"
)

const (
	DefaultResumeTitle  = "未命名简历"
	MaxResumeTitleRunes = 80
)

type ResumeService struct {
	resumes repository.ResumeRepository
	now     func() time.Time
	avatars *AvatarStorage
}

type ResumeServiceConfig struct {
	Resumes   repository.ResumeRepository
	Now       func() time.Time
	AvatarDir string
}

type ListResumesInput struct {
	Query    string
	Status   model.ResumeStatus
	Sort     string
	Page     int
	PageSize int
}

type UpdateResumeInput struct {
	ExpectedRevision int64
	Title            *string
	Status           *model.ResumeStatus
	ProfileAlignment *string
	TemplateID       *string
	ContentVersion   *int
	Content          *map[string]any
}

type ImportResumeInput struct {
	Version          int
	Title            string
	ProfileAlignment *string
	TemplateID       *string
	Content          map[string]any
	Avatar           *string
	SchoolLogo       *string
	ExpectedRevision *int64
}

func NewResumeService(config ResumeServiceConfig) *ResumeService {
	if config.Now == nil {
		config.Now = func() time.Time { return time.Now().UTC() }
	}
	return &ResumeService{resumes: config.Resumes, now: config.Now, avatars: NewAvatarStorage(config.AvatarDir)}
}

func (s *ResumeService) Create(ctx context.Context, userID uuid.UUID, title string) (*model.Resume, error) {
	if strings.TrimSpace(title) == "" {
		title = DefaultResumeTitle
	}
	validatedTitle, err := validateResumeTitle(title)
	if err != nil {
		return nil, err
	}
	contentJSON, err := json.Marshal(DefaultResumeContent())
	if err != nil {
		return nil, model.ErrInternalServer
	}
	now := s.now()
	profileAlignment := DefaultProfileAlignment
	resume := &model.Resume{
		ID:             uuid.New(),
		UserID:         userID,
		Title:          validatedTitle,
		Status:         model.ResumeStatusDraft,
		TemplateID:     &profileAlignment,
		ContentVersion: ContentVersionV4,
		ContentJSON:    model.JSONDocument(contentJSON),
		Revision:       1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.resumes.CreateResume(ctx, resume); err != nil {
		return nil, model.ErrDBError
	}
	return resume, nil
}

func (s *ResumeService) Import(ctx context.Context, userID uuid.UUID, input ImportResumeInput) (*model.Resume, error) {
	validatedTitle, err := validateResumeTitle(input.Title)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	profileAlignment, err := NormalizeProfileAlignment(input.ProfileAlignment, input.TemplateID)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	content, err := normalizeContentForWrite(input.Content, input.Version)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	contentJSON, err := json.Marshal(content)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	now := s.now()
	resume := &model.Resume{
		ID:             uuid.New(),
		UserID:         userID,
		Title:          validatedTitle,
		Status:         model.ResumeStatusDraft,
		TemplateID:     &profileAlignment,
		ContentVersion: ContentVersionV4,
		ContentJSON:    model.JSONDocument(contentJSON),
		Revision:       1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	var avatarBytes, schoolLogoBytes []byte
	if input.Avatar != nil && *input.Avatar != "" {
		avatarBytes, err = DecodeAvatarDataURL(*input.Avatar)
		if err != nil {
			return nil, model.ErrResumeInvalidSchema
		}
	}
	if input.SchoolLogo != nil && *input.SchoolLogo != "" {
		schoolLogoBytes, err = DecodeSchoolLogoDataURL(*input.SchoolLogo)
		if err != nil {
			return nil, model.ErrResumeInvalidSchema
		}
	}
	if err := s.resumes.CreateResume(ctx, resume); err != nil {
		return nil, model.ErrDBError
	}
	if len(avatarBytes) > 0 {
		if _, putErr := s.PutAvatar(ctx, userID, resume.ID, avatarBytes); putErr != nil {
			_ = s.Delete(ctx, userID, resume.ID)
			return nil, putErr
		}
	}
	if len(schoolLogoBytes) > 0 {
		if _, putErr := s.PutSchoolLogo(ctx, userID, resume.ID, schoolLogoBytes); putErr != nil {
			_ = s.Delete(ctx, userID, resume.ID)
			return nil, putErr
		}
	}
	return s.Get(ctx, userID, resume.ID)
}

func (s *ResumeService) Get(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	resume, err := s.resumes.FindResumeByID(ctx, userID, resumeID)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, model.ErrResumeNotFound
	}
	if err != nil {
		return nil, model.ErrDBError
	}
	return resume, nil
}

func (s *ResumeService) List(ctx context.Context, userID uuid.UUID, input ListResumesInput) ([]model.Resume, int, error) {
	if input.Page < 1 || !validPageSize(input.PageSize) || !validSort(input.Sort) || !validResumeStatus(input.Status, true) {
		return nil, 0, model.ErrInvalidParam
	}
	if utf8.RuneCountInString(input.Query) > MaxResumeTitleRunes {
		return nil, 0, model.ErrInvalidParam
	}
	items, total, err := s.resumes.ListResumes(ctx, userID, repository.ResumeListOptions{
		Query:  strings.TrimSpace(input.Query),
		Status: input.Status,
		Sort:   input.Sort,
		Offset: (input.Page - 1) * input.PageSize,
		Limit:  input.PageSize,
	})
	if err != nil {
		return nil, 0, model.ErrDBError
	}
	return items, total, nil
}

func (s *ResumeService) Update(ctx context.Context, userID, resumeID uuid.UUID, input UpdateResumeInput) (*model.Resume, error) {
	if input.ExpectedRevision < 1 ||
		input.Title == nil && input.Status == nil && input.ProfileAlignment == nil && input.TemplateID == nil && input.Content == nil {
		return nil, model.ErrInvalidParam
	}
	resume, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	if resume.ContentVersion != ContentVersionV2 &&
		resume.ContentVersion != ContentVersionV3 &&
		resume.ContentVersion != ContentVersionV4 {
		return nil, model.ErrResumeInvalidSchema
	}
	if input.Title != nil {
		resume.Title, err = validateResumeTitle(*input.Title)
		if err != nil {
			return nil, err
		}
	}
	if input.Status != nil {
		if !validResumeStatus(*input.Status, false) {
			return nil, model.ErrInvalidParam
		}
		resume.Status = *input.Status
	}
	if input.ProfileAlignment != nil || input.TemplateID != nil {
		profileAlignment, normalizeErr := NormalizeProfileAlignment(input.ProfileAlignment, input.TemplateID)
		if normalizeErr != nil {
			return nil, model.ErrInvalidParam
		}
		resume.TemplateID = &profileAlignment
	}
	if input.Content != nil {
		version := resume.ContentVersion
		if input.ContentVersion != nil {
			version = *input.ContentVersion
		}
		contentMap, normalizeErr := normalizeContentForWrite(*input.Content, version)
		if normalizeErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		content, marshalErr := json.Marshal(contentMap)
		if marshalErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		resume.ContentJSON = model.JSONDocument(content)
		resume.ContentVersion = ContentVersionV4
	} else if resume.ContentVersion != ContentVersionV4 {
		storedContent, decodeErr := resumeContentMap(resume)
		if decodeErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		migratedContent, migrateErr := normalizeContentForWrite(storedContent, resume.ContentVersion)
		if migrateErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		content, marshalErr := json.Marshal(migratedContent)
		if marshalErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		resume.ContentJSON = model.JSONDocument(content)
		resume.ContentVersion = ContentVersionV4
	}
	if resume.TemplateID == nil || !ValidProfileAlignment(*resume.TemplateID) {
		profileAlignment, normalizeErr := NormalizeProfileAlignment(nil, resume.TemplateID)
		if normalizeErr != nil {
			return nil, model.ErrResumeInvalidSchema
		}
		resume.TemplateID = &profileAlignment
	}
	resume.Revision = input.ExpectedRevision + 1
	resume.UpdatedAt = s.now()
	if err := s.resumes.UpdateResume(ctx, resume, input.ExpectedRevision); errors.Is(err, repository.ErrNotFound) {
		return nil, model.ErrResumeNotFound
	} else if errors.Is(err, repository.ErrConflict) {
		return nil, model.ErrResumeConflict
	} else if err != nil {
		return nil, model.ErrDBError
	}
	return resume, nil
}

func (s *ResumeService) Copy(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	source, err := s.Get(ctx, userID, resumeID)
	if err != nil {
		return nil, err
	}
	content, err := resumeContentMap(source)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	normalizedContent, err := normalizeContentForWrite(content, source.ContentVersion)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	contentJSON, err := json.Marshal(normalizedContent)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	profileAlignment, err := NormalizeProfileAlignment(nil, source.TemplateID)
	if err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	now := s.now()
	copy := &model.Resume{
		ID:             uuid.New(),
		UserID:         userID,
		Title:          copyTitle(source.Title),
		Status:         model.ResumeStatusDraft,
		TemplateID:     &profileAlignment,
		ContentVersion: ContentVersionV4,
		ContentJSON:    model.JSONDocument(contentJSON),
		Revision:       1,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.resumes.CreateResume(ctx, copy); err != nil {
		return nil, model.ErrDBError
	}
	if source.AvatarKey != nil {
		if avatar, avatarErr := s.avatars.Read(*source.AvatarKey); avatarErr == nil {
			if _, putErr := s.PutAvatar(ctx, userID, copy.ID, avatar); putErr != nil {
				_ = s.Delete(ctx, userID, copy.ID)
				return nil, putErr
			}
		}
	}
	if source.SchoolLogoKey != nil {
		if schoolLogo, schoolLogoErr := s.avatars.Read(*source.SchoolLogoKey); schoolLogoErr == nil {
			if _, putErr := s.PutSchoolLogo(ctx, userID, copy.ID, schoolLogo); putErr != nil {
				_ = s.Delete(ctx, userID, copy.ID)
				return nil, putErr
			}
		}
	}
	return s.Get(ctx, userID, copy.ID)
}

func (s *ResumeService) Delete(ctx context.Context, userID, resumeID uuid.UUID) error {
	resume, getErr := s.Get(ctx, userID, resumeID)
	if getErr != nil {
		return getErr
	}
	if err := s.resumes.DeleteResume(ctx, userID, resumeID); errors.Is(err, repository.ErrNotFound) {
		return model.ErrResumeNotFound
	} else if err != nil {
		return model.ErrDBError
	}
	if resume.AvatarKey != nil {
		_ = s.avatars.Delete(*resume.AvatarKey)
	}
	if resume.SchoolLogoKey != nil {
		_ = s.avatars.Delete(*resume.SchoolLogoKey)
	}
	return nil
}

func (s *ResumeService) ReplaceImport(ctx context.Context, userID, resumeID uuid.UUID, input ImportResumeInput) (*model.Resume, error) {
	if input.ExpectedRevision == nil {
		return nil, model.ErrResumeInvalidSchema
	}
	if _, err := normalizeContentForWrite(input.Content, input.Version); err != nil {
		return nil, model.ErrResumeInvalidSchema
	}
	var avatarBytes, schoolLogoBytes []byte
	if input.Avatar != nil && *input.Avatar != "" {
		var err error
		avatarBytes, err = DecodeAvatarDataURL(*input.Avatar)
		if err != nil {
			return nil, model.ErrResumeInvalidSchema
		}
	}
	if input.SchoolLogo != nil && *input.SchoolLogo != "" {
		var err error
		schoolLogoBytes, err = DecodeSchoolLogoDataURL(*input.SchoolLogo)
		if err != nil {
			return nil, model.ErrResumeInvalidSchema
		}
	}
	updated, err := s.Update(ctx, userID, resumeID, UpdateResumeInput{
		ExpectedRevision: *input.ExpectedRevision,
		Title:            &input.Title,
		ProfileAlignment: input.ProfileAlignment,
		TemplateID:       input.TemplateID,
		ContentVersion:   &input.Version,
		Content:          &input.Content,
	})
	if err != nil {
		return nil, err
	}
	if input.Avatar == nil || *input.Avatar == "" {
		if _, err := s.DeleteAvatar(ctx, userID, resumeID); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.PutAvatar(ctx, userID, resumeID, avatarBytes); err != nil {
			return nil, err
		}
	}
	if input.SchoolLogo == nil || *input.SchoolLogo == "" {
		if _, err := s.DeleteSchoolLogo(ctx, userID, resumeID); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.PutSchoolLogo(ctx, userID, resumeID, schoolLogoBytes); err != nil {
			return nil, err
		}
	}
	return s.Get(ctx, userID, updated.ID)
}

func (s *ResumeService) RecordExport(ctx context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	if err := s.resumes.IncrementResumeExport(ctx, userID, resumeID, s.now()); errors.Is(err, repository.ErrNotFound) {
		return nil, model.ErrResumeNotFound
	} else if err != nil {
		return nil, model.ErrDBError
	}
	return s.Get(ctx, userID, resumeID)
}

func (s *ResumeService) Stats(ctx context.Context, userID uuid.UUID) (repository.ResumeStats, error) {
	stats, err := s.resumes.GetResumeStats(ctx, userID)
	if err != nil {
		return repository.ResumeStats{}, model.ErrDBError
	}
	return stats, nil
}

func validateResumeTitle(title string) (string, error) {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > MaxResumeTitleRunes {
		return "", model.ErrInvalidParam
	}
	return trimmed, nil
}

func validPageSize(value int) bool {
	return value == 6 || value == 12 || value == 24
}

func validSort(value string) bool {
	return value == "updated_desc" || value == "updated_asc" || value == "created_desc" || value == "title_asc"
}

func validResumeStatus(status model.ResumeStatus, optional bool) bool {
	return optional && status == "" || status == model.ResumeStatusDraft || status == model.ResumeStatusCompleted
}

func copyTitle(title string) string {
	const suffix = " - 副本"
	limit := MaxResumeTitleRunes - utf8.RuneCountInString(suffix)
	runes := []rune(strings.TrimSpace(title))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes) + suffix
}

func normalizeContentForWrite(content map[string]any, version int) (map[string]any, error) {
	switch version {
	case ContentVersionV2:
		return MigrateResumeContentV2(content)
	case ContentVersionV3:
		return MigrateResumeContentV3(content)
	case ContentVersionV4:
		if err := ValidateResumeContentVersion(content, ContentVersionV4); err != nil {
			return nil, err
		}
		return content, nil
	default:
		return nil, model.ErrResumeInvalidSchema
	}
}

func resumeContentMap(resume *model.Resume) (map[string]any, error) {
	content := map[string]any{}
	if err := json.Unmarshal(resume.ContentJSON, &content); err != nil {
		return nil, err
	}
	return content, nil
}
