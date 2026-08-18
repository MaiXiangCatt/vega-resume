import type { ProfileAlignment, ResumeFormatting } from './resume.types';

const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;

export const RESUME_PHOTO_SPEC = {
  aspectRatio: 5 / 7,
  heightMm: 35,
  outputHeightPx: 700,
  outputWidthPx: 500,
  widthMm: 25,
} as const;

export const SCHOOL_LOGO_SPEC = {
  heightMm: 25,
  outputHeightPx: 500,
  outputWidthPx: 500,
  widthMm: 25,
} as const;

export const pxToPt = (value: number) => value * 0.75;
export const mmToPx = (value: number) => (value * CSS_PIXELS_PER_INCH) / MILLIMETERS_PER_INCH;

export function formatTargetRole(targetRole: string) {
  return `求职意向：${targetRole}`;
}

export function createResumePresentation(
  formatting: ResumeFormatting,
  profileAlignment: ProfileAlignment,
) {
  const body = formatting.bodyFontSizePx;
  const photoGapPx = body * 2;
  const photoWidthPx = mmToPx(RESUME_PHOTO_SPEC.widthMm);
  const photoHeightPx = mmToPx(RESUME_PHOTO_SPEC.heightMm);
  const schoolLogoHeightPx = mmToPx(SCHOOL_LOGO_SPEC.heightMm);
  return {
    bodyColor: '#242126',
    contactsColumnGapPx: body,
    contactsMarginTopPx: body * 0.8,
    contactsRowGapPx: body * 0.35,
    entryDescriptionMarginTopPx: body * 0.45,
    headerPaddingBottomPx: body * 1.4,
    nameLetterSpacingPx: formatting.nameFontSizePx * -0.02,
    nameLineHeight: 1.08,
    photoGapPx,
    photoHeightPx,
    photoWidthPx,
    profileTextAlign: profileAlignment,
    profileAvatarInsetPx: photoWidthPx + photoGapPx,
    roleMarginTopPx: body * 0.45,
    sectionContentMarginTopPx: body * 0.8,
    sectionTitlePaddingBottomPx: formatting.sectionTitleFontSizePx * 0.35,
    schoolLogoHeightPx,
    schoolLogoOffsetTopPx: (photoHeightPx - schoolLogoHeightPx) / 2,
    schoolLogoWidthPx: mmToPx(SCHOOL_LOGO_SPEC.widthMm),
  };
}
