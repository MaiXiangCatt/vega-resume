package repository

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
)

type MemoryStore struct {
	mu                          sync.RWMutex
	users                       map[uuid.UUID]*model.User
	emailVerificationChallenges map[uuid.UUID]*model.EmailVerificationChallenge
	registrationVerifications   map[uuid.UUID]*model.RegistrationEmailVerification
	registrationInvitations     map[uuid.UUID]*model.RegistrationInvitation
	refreshTokens               map[uuid.UUID]*model.RefreshToken
	resumes                     map[uuid.UUID]*model.Resume
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		users:                       map[uuid.UUID]*model.User{},
		emailVerificationChallenges: map[uuid.UUID]*model.EmailVerificationChallenge{},
		registrationVerifications:   map[uuid.UUID]*model.RegistrationEmailVerification{},
		registrationInvitations:     map[uuid.UUID]*model.RegistrationInvitation{},
		refreshTokens:               map[uuid.UUID]*model.RefreshToken{},
		resumes:                     map[uuid.UUID]*model.Resume{},
	}
}

func (s *MemoryStore) CreateResume(_ context.Context, resume *model.Resume) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	copy := cloneResume(resume)
	now := time.Now().UTC()
	if copy.CreatedAt.IsZero() {
		copy.CreatedAt = now
	}
	if copy.UpdatedAt.IsZero() {
		copy.UpdatedAt = now
	}
	if copy.Revision == 0 {
		copy.Revision = 1
	}
	s.resumes[copy.ID] = copy
	return nil
}

func (s *MemoryStore) FindResumeByID(_ context.Context, userID, resumeID uuid.UUID) (*model.Resume, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	resume, ok := s.resumes[resumeID]
	if !ok || resume.UserID != userID || resume.DeletedAt.Valid {
		return nil, ErrNotFound
	}
	return cloneResume(resume), nil
}

func (s *MemoryStore) ListResumes(_ context.Context, userID uuid.UUID, options ResumeListOptions) ([]model.Resume, int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]model.Resume, 0)
	needle := strings.ToLower(options.Query)
	for _, resume := range s.resumes {
		if resume.UserID != userID || resume.DeletedAt.Valid {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(resume.Title), needle) {
			continue
		}
		if options.Status != "" && resume.Status != options.Status {
			continue
		}
		items = append(items, *cloneResume(resume))
	}
	sort.SliceStable(items, func(i, j int) bool {
		switch options.Sort {
		case "updated_asc":
			return items[i].UpdatedAt.Before(items[j].UpdatedAt)
		case "created_desc":
			return items[i].CreatedAt.After(items[j].CreatedAt)
		case "title_asc":
			return strings.ToLower(items[i].Title) < strings.ToLower(items[j].Title)
		default:
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
	})
	total := len(items)
	start := options.Offset
	if start > total {
		start = total
	}
	end := start + options.Limit
	if end > total {
		end = total
	}
	return items[start:end], total, nil
}

func (s *MemoryStore) UpdateResume(_ context.Context, resume *model.Resume, expectedRevision int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, ok := s.resumes[resume.ID]
	if !ok || existing.UserID != resume.UserID || existing.DeletedAt.Valid {
		return ErrNotFound
	}
	if existing.Revision != expectedRevision {
		return ErrConflict
	}
	copy := cloneResume(resume)
	copy.UpdatedAt = time.Now().UTC()
	s.resumes[copy.ID] = copy
	resume.UpdatedAt = copy.UpdatedAt
	return nil
}

func (s *MemoryStore) SetResumeAvatar(_ context.Context, userID, resumeID uuid.UUID, avatarKey *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	resume, ok := s.resumes[resumeID]
	if !ok || resume.UserID != userID || resume.DeletedAt.Valid {
		return ErrNotFound
	}
	if avatarKey == nil {
		resume.AvatarKey = nil
	} else {
		value := *avatarKey
		resume.AvatarKey = &value
	}
	resume.UpdatedAt = time.Now().UTC()
	return nil
}

func (s *MemoryStore) SetResumeSchoolLogo(_ context.Context, userID, resumeID uuid.UUID, schoolLogoKey *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	resume, ok := s.resumes[resumeID]
	if !ok || resume.UserID != userID || resume.DeletedAt.Valid {
		return ErrNotFound
	}
	if schoolLogoKey == nil {
		resume.SchoolLogoKey = nil
	} else {
		value := *schoolLogoKey
		resume.SchoolLogoKey = &value
	}
	resume.UpdatedAt = time.Now().UTC()
	return nil
}

func (s *MemoryStore) IncrementResumeExport(_ context.Context, userID, resumeID uuid.UUID, updatedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	resume, ok := s.resumes[resumeID]
	if !ok || resume.UserID != userID || resume.DeletedAt.Valid {
		return ErrNotFound
	}
	resume.ExportCount++
	resume.UpdatedAt = updatedAt
	return nil
}

func (s *MemoryStore) DeleteResume(_ context.Context, userID, resumeID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	resume, ok := s.resumes[resumeID]
	if !ok || resume.UserID != userID || resume.DeletedAt.Valid {
		return ErrNotFound
	}
	resume.DeletedAt.Time = time.Now().UTC()
	resume.DeletedAt.Valid = true
	return nil
}

func (s *MemoryStore) GetResumeStats(_ context.Context, userID uuid.UUID) (ResumeStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	stats := ResumeStats{}
	for _, resume := range s.resumes {
		if resume.UserID != userID || resume.DeletedAt.Valid {
			continue
		}
		stats.Total++
		stats.Exported += resume.ExportCount
		if resume.Status == model.ResumeStatusCompleted {
			stats.Completed++
		} else {
			stats.Draft++
		}
	}
	return stats, nil
}

func cloneResume(resume *model.Resume) *model.Resume {
	copy := *resume
	copy.ContentJSON = append(model.JSONDocument(nil), resume.ContentJSON...)
	if resume.TemplateID != nil {
		templateID := *resume.TemplateID
		copy.TemplateID = &templateID
	}
	if resume.AvatarKey != nil {
		avatarKey := *resume.AvatarKey
		copy.AvatarKey = &avatarKey
	}
	if resume.SchoolLogoKey != nil {
		schoolLogoKey := *resume.SchoolLogoKey
		copy.SchoolLogoKey = &schoolLogoKey
	}
	return &copy
}

func (s *MemoryStore) CreateUser(_ context.Context, user *model.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.users {
		if existing.DeletedAt != nil {
			continue
		}
		if existing.EmailNormalized == user.EmailNormalized {
			return ErrDuplicateEmail
		}
		if existing.Username == user.Username {
			return ErrDuplicateUsername
		}
	}

	now := time.Now().UTC()
	copy := *user
	if copy.CreatedAt.IsZero() {
		copy.CreatedAt = now
	}
	if copy.UpdatedAt.IsZero() {
		copy.UpdatedAt = now
	}
	s.users[copy.ID] = &copy
	return nil
}

func (s *MemoryStore) FindActiveUserByID(_ context.Context, id uuid.UUID) (*model.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	user, ok := s.users[id]
	if !ok || user.DeletedAt != nil {
		return nil, ErrNotFound
	}
	copy := *user
	return &copy, nil
}

func (s *MemoryStore) FindActiveUserByEmailNormalized(_ context.Context, emailNormalized string) (*model.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, user := range s.users {
		if user.DeletedAt == nil && user.EmailNormalized == emailNormalized {
			copy := *user
			return &copy, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) FindActiveUserByUsername(_ context.Context, username string) (*model.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, user := range s.users {
		if user.DeletedAt == nil && user.Username == username {
			copy := *user
			return &copy, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) ReplaceEmailVerificationChallenge(
	_ context.Context,
	challenge *model.EmailVerificationChallenge,
	invalidatedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.users[challenge.UserID]; !ok {
		return ErrNotFound
	}
	for _, existing := range s.emailVerificationChallenges {
		if existing.UserID == challenge.UserID && existing.ConsumedAt == nil && existing.InvalidatedAt == nil {
			existing.InvalidatedAt = &invalidatedAt
		}
	}
	copy := *challenge
	s.emailVerificationChallenges[copy.ID] = &copy
	return nil
}

func (s *MemoryStore) FindActiveEmailVerificationChallengeByUserID(
	_ context.Context,
	userID uuid.UUID,
) (*model.EmailVerificationChallenge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var latest *model.EmailVerificationChallenge
	for _, challenge := range s.emailVerificationChallenges {
		if challenge.UserID != userID || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
			continue
		}
		if latest == nil || challenge.CreatedAt.After(latest.CreatedAt) {
			copy := *challenge
			latest = &copy
		}
	}
	if latest == nil {
		return nil, ErrNotFound
	}
	return latest, nil
}

func (s *MemoryStore) IncrementEmailVerificationFailures(_ context.Context, id uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.emailVerificationChallenges[id]
	if !ok || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return 0, ErrNotFound
	}
	challenge.Attempts++
	return challenge.Attempts, nil
}

func (s *MemoryStore) MarkEmailVerificationSent(_ context.Context, id uuid.UUID, sentAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.emailVerificationChallenges[id]
	if !ok || challenge.InvalidatedAt != nil {
		return ErrNotFound
	}
	challenge.SentAt = &sentAt
	return nil
}

func (s *MemoryStore) ConsumeEmailVerificationChallenge(
	_ context.Context,
	challengeID, userID uuid.UUID,
	consumedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.emailVerificationChallenges[challengeID]
	if !ok || challenge.UserID != userID || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return ErrNotFound
	}
	user, ok := s.users[userID]
	if !ok || user.DeletedAt != nil {
		return ErrNotFound
	}
	challenge.ConsumedAt = &consumedAt
	user.EmailVerifiedAt = &consumedAt
	user.UpdatedAt = consumedAt
	return nil
}

func (s *MemoryStore) InvalidateEmailVerificationChallenge(
	_ context.Context,
	id uuid.UUID,
	invalidatedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.emailVerificationChallenges[id]
	if !ok || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return ErrNotFound
	}
	challenge.InvalidatedAt = &invalidatedAt
	return nil
}

func (s *MemoryStore) ReplaceRegistrationEmailVerification(
	_ context.Context,
	challenge *model.RegistrationEmailVerification,
	invalidatedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.registrationVerifications {
		if existing.EmailNormalized == challenge.EmailNormalized &&
			existing.ConsumedAt == nil &&
			existing.InvalidatedAt == nil {
			existing.InvalidatedAt = &invalidatedAt
		}
	}
	copy := *challenge
	s.registrationVerifications[copy.ID] = &copy
	return nil
}

func (s *MemoryStore) FindActiveRegistrationEmailVerification(
	_ context.Context,
	emailNormalized string,
) (*model.RegistrationEmailVerification, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var latest *model.RegistrationEmailVerification
	for _, challenge := range s.registrationVerifications {
		if challenge.EmailNormalized != emailNormalized ||
			challenge.ConsumedAt != nil ||
			challenge.InvalidatedAt != nil {
			continue
		}
		if latest == nil || challenge.CreatedAt.After(latest.CreatedAt) {
			copy := *challenge
			latest = &copy
		}
	}
	if latest == nil {
		return nil, ErrNotFound
	}
	return latest, nil
}

func (s *MemoryStore) IncrementRegistrationEmailVerificationFailures(
	_ context.Context,
	id uuid.UUID,
) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.registrationVerifications[id]
	if !ok || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return 0, ErrNotFound
	}
	challenge.Attempts++
	return challenge.Attempts, nil
}

func (s *MemoryStore) MarkRegistrationEmailVerificationSent(
	_ context.Context,
	id uuid.UUID,
	sentAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.registrationVerifications[id]
	if !ok || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return ErrNotFound
	}
	challenge.SentAt = &sentAt
	return nil
}

func (s *MemoryStore) InvalidateRegistrationEmailVerification(
	_ context.Context,
	id uuid.UUID,
	invalidatedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.registrationVerifications[id]
	if !ok || challenge.ConsumedAt != nil || challenge.InvalidatedAt != nil {
		return ErrNotFound
	}
	challenge.InvalidatedAt = &invalidatedAt
	return nil
}

func (s *MemoryStore) CreateVerifiedUser(
	_ context.Context,
	challengeID uuid.UUID,
	invitationID *uuid.UUID,
	user *model.User,
	consumedAt time.Time,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	challenge, ok := s.registrationVerifications[challengeID]
	if !ok ||
		challenge.EmailNormalized != user.EmailNormalized ||
		challenge.ConsumedAt != nil ||
		challenge.InvalidatedAt != nil ||
		!challenge.ExpiresAt.After(consumedAt) {
		return ErrNotFound
	}
	var invitation *model.RegistrationInvitation
	if invitationID != nil {
		candidate, exists := s.registrationInvitations[*invitationID]
		if !exists || candidate.ConsumedAt != nil || !candidate.ExpiresAt.After(consumedAt) {
			return ErrInvitationInvalid
		}
		invitation = candidate
	}
	for _, existing := range s.users {
		if existing.DeletedAt != nil {
			continue
		}
		if existing.EmailNormalized == user.EmailNormalized {
			return ErrDuplicateEmail
		}
		if existing.Username == user.Username {
			return ErrDuplicateUsername
		}
	}
	copy := *user
	s.users[copy.ID] = &copy
	challenge.ConsumedAt = &consumedAt
	if invitation != nil {
		invitation.ConsumedAt = &consumedAt
	}
	return nil
}

func (s *MemoryStore) CreateRegistrationInvitation(
	_ context.Context,
	invitation *model.RegistrationInvitation,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.registrationInvitations {
		if existing.CodeHash == invitation.CodeHash {
			return ErrConflict
		}
	}
	copy := *invitation
	s.registrationInvitations[copy.ID] = &copy
	return nil
}

func (s *MemoryStore) FindActiveRegistrationInvitationByCodeHash(
	_ context.Context,
	codeHash string,
	now time.Time,
) (*model.RegistrationInvitation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, invitation := range s.registrationInvitations {
		if invitation.CodeHash == codeHash &&
			invitation.ConsumedAt == nil &&
			invitation.ExpiresAt.After(now) {
			copy := *invitation
			return &copy, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) CreateRefreshToken(_ context.Context, token *model.RefreshToken) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, existing := range s.refreshTokens {
		if existing.TokenHash == token.TokenHash {
			return ErrDuplicateUsername
		}
	}
	copy := *token
	if copy.CreatedAt.IsZero() {
		copy.CreatedAt = time.Now().UTC()
	}
	s.refreshTokens[copy.ID] = &copy
	return nil
}

func (s *MemoryStore) FindActiveRefreshTokenByHash(_ context.Context, tokenHash string) (*model.RefreshToken, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, token := range s.refreshTokens {
		if token.TokenHash == tokenHash && token.RevokedAt == nil {
			copy := *token
			return &copy, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) RevokeRefreshToken(_ context.Context, id uuid.UUID, replacementID *uuid.UUID, revokedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	token, ok := s.refreshTokens[id]
	if !ok {
		return ErrNotFound
	}
	token.RevokedAt = &revokedAt
	token.ReplacedByTokenID = replacementID
	return nil
}

func (s *MemoryStore) RotateRefreshToken(_ context.Context, id uuid.UUID, replacement *model.RefreshToken, revokedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, ok := s.refreshTokens[id]
	if !ok || current.RevokedAt != nil {
		return ErrNotFound
	}
	for _, existing := range s.refreshTokens {
		if existing.TokenHash == replacement.TokenHash {
			return ErrDuplicateUsername
		}
	}

	replacementCopy := *replacement
	if replacementCopy.CreatedAt.IsZero() {
		replacementCopy.CreatedAt = time.Now().UTC()
	}
	s.refreshTokens[replacementCopy.ID] = &replacementCopy
	current.RevokedAt = &revokedAt
	current.ReplacedByTokenID = &replacementCopy.ID
	return nil
}
