package service_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/vega-resume/server/internal/service"
)

func TestResumeContentV4FormattingValidation(t *testing.T) {
	content := service.DefaultResumeContent()
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("default content should be valid: %v", err)
	}

	formatting := content["formatting"].(map[string]any)
	formatting["nameFontSizePx"] = 49
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("out-of-range name font size should be rejected")
	}

	formatting["nameFontSizePx"] = 20
	formatting["lineHeightRatio"] = 1.53
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("valid decimal line height should be accepted: %v", err)
	}

	margins := formatting["pageMarginPx"].(map[string]any)
	margins["left"] = -1
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("negative page margin should be rejected")
	}

	margins["left"] = 33
	formatting["fontFamily"] = "source-han-serif"
	formatting["accentColor"] = "#123abc"
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("supported font and custom accent should be accepted: %v", err)
	}

	formatting["accentColor"] = "#12xyz9"
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("invalid custom accent should be rejected")
	}

	formatting["accentColor"] = "plum"
	for _, entryGap := range []any{0, 64} {
		formatting["entryGapPx"] = entryGap
		if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
			t.Fatalf("entry gap boundary %v should be valid: %v", entryGap, err)
		}
	}
	for _, entryGap := range []any{-1, 65, 1.5} {
		formatting["entryGapPx"] = entryGap
		if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
			t.Fatalf("entry gap %v should be rejected", entryGap)
		}
	}
}

func TestResumeContentV4SpacingOverridesAndMigration(t *testing.T) {
	content := service.DefaultResumeContent()
	sections := content["sections"].([]any)
	work := sections[1].(map[string]any)
	work["spacingBeforePx"] = 0
	work["items"] = []any{
		map[string]any{
			"id": "work-1", "company": "公司", "role": "工程师", "location": "",
			"startDate": "", "endDate": "", "isCurrent": false, "description": "",
			"spacingBeforePx": 64,
		},
	}
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("valid spacing overrides should be accepted: %v", err)
	}
	work["spacingBeforePx"] = 2.5
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("fractional spacing override should be rejected")
	}

	v2 := service.DefaultResumeContent()
	delete(v2["profile"].(map[string]any), "enabled")
	delete(v2["profile"].(map[string]any), "politicalStatus")
	formatting := v2["formatting"].(map[string]any)
	delete(formatting, "entryGapPx")
	formatting["bodyFontSizePx"] = 13
	migrated, err := service.MigrateResumeContentV2(v2)
	if err != nil {
		t.Fatalf("migrate v2 content: %v", err)
	}
	if got := migrated["formatting"].(map[string]any)["entryGapPx"]; got != float64(13) {
		t.Fatalf("entry gap should inherit v2 body size, got %v", got)
	}
	if got := migrated["profile"].(map[string]any)["enabled"]; got != true {
		t.Fatalf("v2 profile should migrate to enabled, got %v", got)
	}
	if got := migrated["profile"].(map[string]any)["politicalStatus"]; got != "" {
		t.Fatalf("v2 profile should migrate to an empty political status, got %v", got)
	}
	if err := service.ValidateResumeContentVersion(v2, service.ContentVersionV2); err != nil {
		t.Fatalf("v2 source should remain valid: %v", err)
	}

	v3 := service.DefaultResumeContent()
	delete(v3["profile"].(map[string]any), "enabled")
	delete(v3["profile"].(map[string]any), "politicalStatus")
	migrated, err = service.MigrateResumeContentV3(v3)
	if err != nil {
		t.Fatalf("migrate v3 content: %v", err)
	}
	if got := migrated["profile"].(map[string]any)["enabled"]; got != true {
		t.Fatalf("v3 profile should migrate to enabled, got %v", got)
	}
	if got := migrated["profile"].(map[string]any)["politicalStatus"]; got != "" {
		t.Fatalf("v3 profile should migrate to an empty political status, got %v", got)
	}
}

func TestResumeContentV4PoliticalStatusCompatibility(t *testing.T) {
	content := service.DefaultResumeContent()
	profile := content["profile"].(map[string]any)
	delete(profile, "politicalStatus")
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("legacy v4 profile without political status should remain valid: %v", err)
	}

	profile["politicalStatus"] = "中共党员"
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("political status should be valid: %v", err)
	}
	profile["politicalStatus"] = 1
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("non-string political status should be rejected")
	}
	profile["politicalStatus"] = strings.Repeat("党", 321)
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("oversized political status should be rejected")
	}
}

func TestResumeContentV4RequiresProfileVisibility(t *testing.T) {
	content := service.DefaultResumeContent()
	profile := content["profile"].(map[string]any)
	profile["enabled"] = false
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err != nil {
		t.Fatalf("hidden profile should be valid: %v", err)
	}
	delete(profile, "enabled")
	if err := service.ValidateResumeContentVersion(content, service.ContentVersionV4); err == nil {
		t.Fatal("v4 profile without enabled should be rejected")
	}
}

func TestProfileAlignmentCompatibility(t *testing.T) {
	modern := "modern-editorial"
	center := "center"
	classic := "classic-professional"
	right := "right"

	if got, err := service.NormalizeProfileAlignment(nil, &modern); err != nil || got != "left" {
		t.Fatalf("modern template should map left: got=%q err=%v", got, err)
	}
	if got, err := service.NormalizeProfileAlignment(&center, &classic); err != nil || got != "center" {
		t.Fatalf("matching dual fields should be accepted: got=%q err=%v", got, err)
	}
	if _, err := service.NormalizeProfileAlignment(&right, &classic); err == nil {
		t.Fatal("conflicting dual fields should be rejected")
	}
	if got := service.LegacyTemplateIDForAlignment("right"); got != nil {
		t.Fatalf("right alignment must not have a legacy projection: %v", *got)
	}
}

func TestResumeContentV4RejectsOversizedTextFields(t *testing.T) {
	content := service.DefaultResumeContent()
	sections := content["sections"].([]any)
	summary := sections[0].(map[string]any)
	summary["text"] = strings.Repeat("简", service.MaxResumeDescriptionRunes+1)

	if err := service.ValidateResumeContent(content); err == nil {
		t.Fatal("oversized Markdown description should be rejected")
	}
}

func TestResumeContentV4RejectsOversizedSerializedDocument(t *testing.T) {
	content := service.DefaultResumeContent()
	sections := content["sections"].([]any)
	for index := 0; index < 30; index++ {
		sections = append(sections, map[string]any{
			"id":      fmt.Sprintf("custom-%d", index),
			"type":    "custom",
			"title":   "自定义",
			"enabled": true,
			"items": []any{
				map[string]any{
					"id":          fmt.Sprintf("item-%d", index),
					"title":       "条目",
					"subtitle":    "",
					"location":    "",
					"startDate":   "",
					"endDate":     "",
					"isCurrent":   false,
					"description": strings.Repeat("x", service.MaxResumeDescriptionRunes),
				},
			},
		})
	}
	content["sections"] = sections

	if err := service.ValidateResumeContent(content); err == nil {
		t.Fatal("serialized resume above the total size limit should be rejected")
	}
}

func TestResumeContentV4RejectsLegacyFormatting(t *testing.T) {
	content := service.DefaultResumeContent()
	content["formatting"] = map[string]any{
		"fontSize": "standard", "lineHeight": "standard", "pageMargin": "standard",
		"sectionGap": "standard", "accentColor": "plum",
	}

	if err := service.ValidateResumeContent(content); err == nil {
		t.Fatal("legacy formatting should be rejected")
	}
}

func TestResumeContentV4SkillsUseMarkdownDescription(t *testing.T) {
	content := service.DefaultResumeContent()
	sections := content["sections"].([]any)
	skills := sections[4].(map[string]any)

	skills["description"] = "- **TypeScript**：熟练"
	if err := service.ValidateResumeContent(content); err != nil {
		t.Fatalf("Markdown skills description should be accepted: %v", err)
	}

	delete(skills, "description")
	skills["items"] = []any{
		map[string]any{"id": "skill-1", "name": "TypeScript", "level": "proficient"},
	}
	if err := service.ValidateResumeContent(content); err == nil {
		t.Fatal("legacy structured skills should be rejected")
	}
}
