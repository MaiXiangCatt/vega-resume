package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/vega-resume/server/internal/model"
	pdfservice "github.com/vega-resume/server/internal/pdf"
	"github.com/vega-resume/server/internal/repository"
	"github.com/vega-resume/server/internal/service"
)

var errAny = errors.New("renderer boom")

func registerAccessToken(t *testing.T, router http.Handler, username, email string) string {
	t.Helper()
	testVerificationCodes.Delete(email)
	sent := performJSON(router, http.MethodPost, "/api/auth/registration-email-verification", `{
		"email": "`+email+`"
	}`)
	if sent.Code != http.StatusOK {
		t.Fatalf("send verification status=%d body=%s", sent.Code, sent.Body.String())
	}
	code, ok := testVerificationCodes.Load(email)
	if !ok {
		t.Fatalf("verification code was not sent to %s", email)
	}
	response := performJSON(router, http.MethodPost, "/api/auth/register", `{
		"username": "`+username+`",
		"email": "`+email+`",
		"password": "password1",
		"confirmPassword": "password1",
		"verificationCode": "`+code.(string)+`"
	}`)
	if response.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", response.Code, response.Body.String())
	}
	return decodeEnvelope(t, response)["data"].(map[string]any)["accessToken"].(string)
}

func performAuthorizedJSON(router http.Handler, token, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	return response
}

func TestResumeHandlersLifecycleAndStats(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "resume-user", "resume@example.com")

	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	createdData := decodeEnvelope(t, created)["data"].(map[string]any)
	resumeID := createdData["id"].(string)
	if createdData["status"] != "draft" ||
		createdData["profileAlignment"] != "left" ||
		createdData["templateId"] != "modern-editorial" ||
		createdData["contentVersion"] != float64(4) {
		t.Fatalf("new resume should be draft: %+v", createdData)
	}

	updated := performAuthorizedJSON(router, token, http.MethodPatch, "/api/resumes/"+resumeID, `{"expectedRevision":1,"title":"控制台简历","status":"completed"}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", updated.Code, updated.Body.String())
	}

	copied := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/copy", "")
	if copied.Code != http.StatusOK {
		t.Fatalf("copy status=%d body=%s", copied.Code, copied.Body.String())
	}

	list := performAuthorizedJSON(router, token, http.MethodGet, "/api/resumes?status=draft&page=1&pageSize=6&sort=updated_desc", "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", list.Code, list.Body.String())
	}
	listData := decodeEnvelope(t, list)["data"].(map[string]any)
	if listData["total"] != float64(1) {
		t.Fatalf("unexpected filtered list: %+v", listData)
	}

	stats := performAuthorizedJSON(router, token, http.MethodGet, "/api/resumes/stats", "")
	statsData := decodeEnvelope(t, stats)["data"].(map[string]any)
	if statsData["total"] != float64(2) || statsData["draft"] != float64(1) || statsData["completed"] != float64(1) {
		t.Fatalf("unexpected stats: %+v", statsData)
	}

	deleted := performAuthorizedJSON(router, token, http.MethodDelete, "/api/resumes/"+resumeID, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status=%d body=%s", deleted.Code, deleted.Body.String())
	}
}

func TestResumeHandlersAcceptCompatibleAlignmentFieldsAndRejectConflicts(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "alignment-user", "alignment@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	compatible := performAuthorizedJSON(
		router,
		token,
		http.MethodPatch,
		"/api/resumes/"+resumeID,
		`{"expectedRevision":1,"profileAlignment":"center","templateId":"classic-professional"}`,
	)
	if compatible.Code != http.StatusOK {
		t.Fatalf("compatible fields status=%d body=%s", compatible.Code, compatible.Body.String())
	}
	compatibleData := decodeEnvelope(t, compatible)["data"].(map[string]any)
	if compatibleData["profileAlignment"] != "center" ||
		compatibleData["templateId"] != "classic-professional" {
		t.Fatalf("unexpected compatible projection: %+v", compatibleData)
	}

	conflict := performAuthorizedJSON(
		router,
		token,
		http.MethodPatch,
		"/api/resumes/"+resumeID,
		`{"expectedRevision":2,"profileAlignment":"right","templateId":"classic-professional"}`,
	)
	if conflict.Code != http.StatusBadRequest {
		t.Fatalf("conflicting fields status=%d body=%s", conflict.Code, conflict.Body.String())
	}

	right := performAuthorizedJSON(
		router,
		token,
		http.MethodPatch,
		"/api/resumes/"+resumeID,
		`{"expectedRevision":2,"profileAlignment":"right"}`,
	)
	if right.Code != http.StatusOK {
		t.Fatalf("right alignment status=%d body=%s", right.Code, right.Body.String())
	}
	rightData := decodeEnvelope(t, right)["data"].(map[string]any)
	if rightData["profileAlignment"] != "right" || rightData["templateId"] != nil {
		t.Fatalf("right alignment legacy projection must be null: %+v", rightData)
	}

	content := service.DefaultResumeContent()
	content["unexpected"] = true
	payload, err := json.Marshal(map[string]any{
		"expectedRevision": 3,
		"contentVersion":   4,
		"content":          content,
	})
	if err != nil {
		t.Fatalf("marshal strict validation payload: %v", err)
	}
	strict := performAuthorizedJSON(
		router,
		token,
		http.MethodPatch,
		"/api/resumes/"+resumeID,
		string(payload),
	)
	if strict.Code != http.StatusBadRequest {
		t.Fatalf("v4 unknown content field status=%d body=%s", strict.Code, strict.Body.String())
	}
}

func TestResumeHandlersRejectOversizedUpdateBody(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "large-update-user", "large-update@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	updated := performAuthorizedJSON(
		router,
		token,
		http.MethodPatch,
		"/api/resumes/"+resumeID,
		`{"expectedRevision":1,"content":{"padding":"`+strings.Repeat("x", 600<<10)+`"}}`,
	)
	if updated.Code != http.StatusBadRequest {
		t.Fatalf("oversized update status=%d body=%s", updated.Code, updated.Body.String())
	}
}

func TestResumeHandlersRequireAuthenticationAndIsolateOwners(t *testing.T) {
	router := newTestRouter(t)
	unauthorized := performJSON(router, http.MethodGet, "/api/resumes", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized list, got %d body=%s", unauthorized.Code, unauthorized.Body.String())
	}

	ownerToken := registerAccessToken(t, router, "owner-user", "owner@example.com")
	otherToken := registerAccessToken(t, router, "other-user", "other@example.com")
	created := performAuthorizedJSON(router, ownerToken, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	read := performAuthorizedJSON(router, otherToken, http.MethodGet, "/api/resumes/"+resumeID, "")
	if read.Code != http.StatusNotFound {
		t.Fatalf("cross-owner read should look missing, got %d body=%s", read.Code, read.Body.String())
	}
}

func TestResumeAvatarAcceptsFiveBySevenJPEG(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "avatar-user", "avatar@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	var avatar bytes.Buffer
	if err := jpeg.Encode(
		&avatar,
		image.NewRGBA(image.Rect(0, 0, service.AvatarWidth, service.AvatarHeight)),
		&jpeg.Options{Quality: 82},
	); err != nil {
		t.Fatalf("encode avatar: %v", err)
	}
	request := httptest.NewRequest(
		http.MethodPut,
		"/api/resumes/"+resumeID+"/avatar",
		bytes.NewReader(avatar.Bytes()),
	)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "image/jpeg; name=avatar.jpg")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("upload avatar status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestResumeSchoolLogoAcceptsSquarePNG(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "school-logo-user", "school-logo@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)
	logo := pngSchoolLogo(t)

	request := httptest.NewRequest(
		http.MethodPut,
		"/api/resumes/"+resumeID+"/school-logo",
		bytes.NewReader(logo),
	)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "image/png; name=school-logo.png")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("upload school logo status=%d body=%s", response.Code, response.Body.String())
	}
	if hasLogo := decodeEnvelope(t, response)["data"].(map[string]any)["hasSchoolLogo"]; hasLogo != true {
		t.Fatalf("hasSchoolLogo = %v", hasLogo)
	}

	read := performAuthorizedJSON(router, token, http.MethodGet, "/api/resumes/"+resumeID+"/school-logo", "")
	if read.Code != http.StatusOK || read.Header().Get("Content-Type") != "image/png" || !bytes.Equal(read.Body.Bytes(), logo) {
		t.Fatalf("read school logo status=%d content-type=%q", read.Code, read.Header().Get("Content-Type"))
	}

	deleted := performAuthorizedJSON(router, token, http.MethodDelete, "/api/resumes/"+resumeID+"/school-logo", "")
	if deleted.Code != http.StatusOK || decodeEnvelope(t, deleted)["data"].(map[string]any)["hasSchoolLogo"] != false {
		t.Fatalf("delete school logo status=%d body=%s", deleted.Code, deleted.Body.String())
	}
}

func TestResumeSchoolLogoRejectsInvalidFormatAndOversizedFile(t *testing.T) {
	router := newTestRouter(t)
	token := registerAccessToken(t, router, "invalid-school-logo-user", "invalid-school-logo@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	wrongFormat := httptest.NewRequest(
		http.MethodPut,
		"/api/resumes/"+resumeID+"/school-logo",
		bytes.NewReader(pngSchoolLogo(t)),
	)
	wrongFormat.Header.Set("Authorization", "Bearer "+token)
	wrongFormat.Header.Set("Content-Type", "image/jpeg")
	wrongFormatResponse := httptest.NewRecorder()
	router.ServeHTTP(wrongFormatResponse, wrongFormat)
	if wrongFormatResponse.Code != http.StatusBadRequest || decodeEnvelope(t, wrongFormatResponse)["code"] != float64(model.ErrSchoolLogoInvalid.Code) {
		t.Fatalf("wrong format status=%d body=%s", wrongFormatResponse.Code, wrongFormatResponse.Body.String())
	}

	oversized := httptest.NewRequest(
		http.MethodPut,
		"/api/resumes/"+resumeID+"/school-logo",
		bytes.NewReader(make([]byte, service.MaxSchoolLogoBytes+1)),
	)
	oversized.Header.Set("Authorization", "Bearer "+token)
	oversized.Header.Set("Content-Type", "image/png")
	oversizedResponse := httptest.NewRecorder()
	router.ServeHTTP(oversizedResponse, oversized)
	if oversizedResponse.Code != http.StatusBadRequest || decodeEnvelope(t, oversizedResponse)["code"] != float64(model.ErrFileTooLarge.Code) {
		t.Fatalf("oversized status=%d body=%s", oversizedResponse.Code, oversizedResponse.Body.String())
	}
}

func TestExportResumePdfReturnsPdfAndRecordsExport(t *testing.T) {
	renderer := &stubRenderer{data: []byte("%PDF-1.7 stub")}
	router := newTestRouterWithRenderer(t, renderer)
	token := registerAccessToken(t, router, "export-user", "export@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	exported := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if exported.Code != http.StatusOK {
		t.Fatalf("export status=%d body=%s", exported.Code, exported.Body.String())
	}
	if got := exported.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("content type = %q", got)
	}
	if !strings.HasPrefix(exported.Body.String(), "%PDF") {
		t.Fatalf("body is not pdf: %q", exported.Body.String())
	}
	if got := exported.Header().Get("Content-Disposition"); !strings.Contains(got, ".pdf") {
		t.Fatalf("content disposition = %q", got)
	}
	if !strings.HasPrefix(renderer.gotURL, "http://web.test/print/resumes/"+resumeID+"#token=") {
		t.Fatalf("renderer url = %q", renderer.gotURL)
	}
	if strings.Contains(renderer.gotURL, "?") {
		t.Fatalf("print token must not be sent in a query string: %q", renderer.gotURL)
	}

	stats := performAuthorizedJSON(router, token, http.MethodGet, "/api/resumes/stats", "")
	statsData := decodeEnvelope(t, stats)["data"].(map[string]any)
	if statsData["exported"] != float64(1) {
		t.Fatalf("export not recorded: %+v", statsData)
	}
}

func TestExportResumePdfRejectsUnauthorizedAndForeignResumes(t *testing.T) {
	router := newTestRouter(t)
	ownerToken := registerAccessToken(t, router, "pdf-owner", "pdf-owner@example.com")
	otherToken := registerAccessToken(t, router, "pdf-other", "pdf-other@example.com")
	created := performAuthorizedJSON(router, ownerToken, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	anonymous := performJSON(router, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous export status=%d", anonymous.Code)
	}
	foreign := performAuthorizedJSON(router, otherToken, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign export status=%d body=%s", foreign.Code, foreign.Body.String())
	}
}

func TestExportResumePdfMapsRendererFailure(t *testing.T) {
	router := newTestRouterWithRenderer(t, &stubRenderer{err: errAny})
	token := registerAccessToken(t, router, "fail-user", "fail@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	exported := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if exported.Code != http.StatusInternalServerError {
		t.Fatalf("export status=%d body=%s", exported.Code, exported.Body.String())
	}
	if code := decodeEnvelope(t, exported)["code"]; code != float64(106001) {
		t.Fatalf("error code = %v", code)
	}

	stats := performAuthorizedJSON(router, token, http.MethodGet, "/api/resumes/stats", "")
	if statsData := decodeEnvelope(t, stats)["data"].(map[string]any); statsData["exported"] != float64(0) {
		t.Fatalf("failed export must not be recorded: %+v", statsData)
	}
}

func TestExportResumePdfRejectsQuicklyWhenRendererIsBusy(t *testing.T) {
	router := newTestRouterWithRenderer(t, &stubRenderer{err: pdfservice.ErrBusy})
	token := registerAccessToken(t, router, "busy-user", "busy@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	exported := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if exported.Code != http.StatusServiceUnavailable {
		t.Fatalf("export status=%d body=%s", exported.Code, exported.Body.String())
	}
	if code := decodeEnvelope(t, exported)["code"]; code != float64(model.ErrPdfBusy.Code) {
		t.Fatalf("error code = %v", code)
	}
}

type failingExportStore struct {
	*repository.MemoryStore
}

func (s *failingExportStore) IncrementResumeExport(
	_ context.Context,
	_, _ uuid.UUID,
	_ time.Time,
) error {
	return errAny
}

func TestExportResumePdfFailsWhenExportCannotBeRecorded(t *testing.T) {
	renderer := &stubRenderer{data: []byte("%PDF-stub")}
	store := &failingExportStore{MemoryStore: repository.NewMemoryStore()}
	router := newTestRouterWithStoreAndRenderer(t, store, renderer)
	token := registerAccessToken(t, router, "record-fail-user", "record-fail@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)

	exported := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	if exported.Code != http.StatusInternalServerError {
		t.Fatalf("export status=%d body=%s", exported.Code, exported.Body.String())
	}
	if code := decodeEnvelope(t, exported)["code"]; code != float64(200002) {
		t.Fatalf("error code = %v", code)
	}
}

func TestGetResumePrintDataAuthorizedByPrintToken(t *testing.T) {
	renderer := &stubRenderer{data: []byte("%PDF-stub")}
	router := newTestRouterWithRenderer(t, renderer)
	token := registerAccessToken(t, router, "print-user", "print@example.com")
	created := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	resumeID := decodeEnvelope(t, created)["data"].(map[string]any)["id"].(string)
	logoRequest := httptest.NewRequest(
		http.MethodPut,
		"/api/resumes/"+resumeID+"/school-logo",
		bytes.NewReader(pngSchoolLogo(t)),
	)
	logoRequest.Header.Set("Authorization", "Bearer "+token)
	logoRequest.Header.Set("Content-Type", "image/png")
	logoResponse := httptest.NewRecorder()
	router.ServeHTTP(logoResponse, logoRequest)
	if logoResponse.Code != http.StatusOK {
		t.Fatalf("upload school logo status=%d body=%s", logoResponse.Code, logoResponse.Body.String())
	}

	performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+resumeID+"/export/pdf", "")
	printToken := renderer.gotURL[strings.Index(renderer.gotURL, "#token=")+len("#token="):]
	printPath := "/api/resumes/" + resumeID + "/print"

	printed := performPrintJSON(router, printPath, printToken)
	if printed.Code != http.StatusOK {
		t.Fatalf("print data status=%d body=%s", printed.Code, printed.Body.String())
	}
	printData := decodeEnvelope(t, printed)["data"].(map[string]any)
	resume := printData["resume"].(map[string]any)
	if resume["id"] != resumeID {
		t.Fatalf("unexpected print resume: %+v", resume)
	}
	if logo, ok := printData["schoolLogoDataUrl"].(string); !ok || !strings.HasPrefix(logo, "data:image/png;base64,") {
		t.Fatalf("missing school logo data URL: %+v", printData)
	}

	reused := performPrintJSON(router, printPath, printToken)
	if reused.Code != http.StatusUnauthorized {
		t.Fatalf("reused token status=%d body=%s", reused.Code, reused.Body.String())
	}

	invalid := performPrintJSON(router, printPath, "not-a-token")
	if invalid.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token status=%d", invalid.Code)
	}
}

func pngSchoolLogo(t *testing.T) []byte {
	t.Helper()
	var logo bytes.Buffer
	if err := png.Encode(
		&logo,
		image.NewRGBA(image.Rect(0, 0, service.SchoolLogoWidth, service.SchoolLogoHeight)),
	); err != nil {
		t.Fatalf("encode school logo: %v", err)
	}
	return logo.Bytes()
}

func TestGetResumePrintDataRejectsTokenForOtherResume(t *testing.T) {
	renderer := &stubRenderer{data: []byte("%PDF-stub")}
	router := newTestRouterWithRenderer(t, renderer)
	token := registerAccessToken(t, router, "swap-user", "swap@example.com")
	first := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	firstID := decodeEnvelope(t, first)["data"].(map[string]any)["id"].(string)
	second := performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes", `{}`)
	secondID := decodeEnvelope(t, second)["data"].(map[string]any)["id"].(string)

	performAuthorizedJSON(router, token, http.MethodPost, "/api/resumes/"+firstID+"/export/pdf", "")
	firstToken := renderer.gotURL[strings.Index(renderer.gotURL, "#token=")+len("#token="):]

	swapped := performPrintJSON(router, "/api/resumes/"+secondID+"/print", firstToken)
	if swapped.Code != http.StatusUnauthorized {
		t.Fatalf("token for other resume status=%d body=%s", swapped.Code, swapped.Body.String())
	}
}

func performPrintJSON(router http.Handler, path, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("X-Print-Token", token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
