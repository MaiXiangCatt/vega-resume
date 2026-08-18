import { memo, type CSSProperties } from 'react';

import { Card } from '@/shared/ui/card';
import { Link } from '@/shared/ui/link';
import { cn } from '@/shared/lib/utils';

import { RESUME_FONT_FAMILIES, resolveAccentColor } from '../model/resume.model';
import {
  getEntryDisplay,
  itemHasPrintableContent,
  profileHasPrintableContent,
  sectionHasPrintableContent,
} from '../model/resume.preview';
import { createResumePresentation, formatTargetRole } from '../model/resume.presentation';
import type { ResumeDocument, ResumeFormatting, ResumeSection } from '../model/resume.types';
import { ResumeMarkdownHtml } from './ResumeMarkdownHtml';

type ResumeHtmlPreviewProps = {
  avatar: string | null;
  schoolLogo?: string | null;
  resume: ResumeDocument;
  mode?: 'screen' | 'print';
};

export const ResumeHtmlPreview = memo(function ResumeHtmlPreview({
  avatar,
  schoolLogo = null,
  resume,
  mode = 'screen',
}: ResumeHtmlPreviewProps) {
  const isPrint = mode === 'print';
  const formatting = resume.content.formatting;
  const profile = resume.content.profile;
  const profileAlignment = resume.profileAlignment;
  const visibleAvatar = profile.enabled ? avatar : null;
  const visibleSchoolLogo = profile.enabled ? schoolLogo : null;
  const accent = resolveAccentColor(formatting.accentColor);
  const presentation = createResumePresentation(formatting, profileAlignment);
  const hasMedia = Boolean(visibleAvatar || visibleSchoolLogo);
  const hasCenteredMedia = profileAlignment === 'center' && hasMedia;
  const hasSideMedia = hasMedia && !hasCenteredMedia;
  const avatarOnLeft = profileAlignment === 'right';
  const schoolLogoOnLeft = !avatarOnLeft;
  const hasPrintableProfile = profileHasPrintableContent(
    profile,
    Boolean(visibleAvatar),
    Boolean(visibleSchoolLogo),
  );
  const printableSections = resume.content.sections.filter(sectionHasPrintableContent);
  const style = {
    '--resume-accent': accent,
    ...(isPrint ? {} : { containerType: 'inline-size' }),
    fontFamily: RESUME_FONT_FAMILIES[formatting.fontFamily].cssFamily,
    fontSize: `${formatting.bodyFontSizePx}px`,
    lineHeight: formatting.lineHeightRatio,
  } as CSSProperties;
  const contacts = [profile.phone, profile.email, profile.location].filter(Boolean);
  const printableLinks = profile.links.filter((link) => link.label && link.url);

  return (
    <Card
      aria-label={`${resume.title} A4 实时预览`}
      className={cn(
        'mx-auto w-full shrink-0 gap-0 border-0 bg-white py-0 text-[#242126]',
        isPrint
          ? 'max-w-none rounded-none shadow-none'
          : 'max-w-[794px] rounded-[2px] shadow-[0_26px_70px_rgba(31,24,29,0.24)]',
      )}
      data-profile-alignment={profileAlignment}
      style={style}
    >
      <article
        className={isPrint ? undefined : 'min-h-[141.428cqw]'}
        style={
          // 打印模式的页边距由 @page margin 承担，article 不再加 padding，
          // 否则第 2 页起上下边距会丢失。
          isPrint
            ? undefined
            : {
                paddingBottom: formatting.pageMarginPx.bottom,
                paddingLeft: formatting.pageMarginPx.left,
                paddingRight: formatting.pageMarginPx.right,
                paddingTop: formatting.pageMarginPx.top,
              }
        }
      >
        {hasPrintableProfile ? (
          <header
            className={cn(
              'flex',
              hasCenteredMedia && 'relative flex-col',
              hasSideMedia && 'flex-row items-start justify-between',
              !hasMedia && 'flex-col',
            )}
            style={{
              minHeight: hasMedia
                ? presentation.photoHeightPx + presentation.headerPaddingBottomPx
                : undefined,
              paddingBottom: presentation.headerPaddingBottomPx,
            }}
          >
            {visibleAvatar && avatarOnLeft ? (
              <img
                alt=""
                className="shrink-0 object-contain"
                src={visibleAvatar}
                style={{
                  height: presentation.photoHeightPx,
                  marginRight: presentation.photoGapPx,
                  width: presentation.photoWidthPx,
                }}
              />
            ) : visibleSchoolLogo && schoolLogoOnLeft ? (
              <img
                alt=""
                className={cn('shrink-0 object-contain', hasCenteredMedia && 'absolute left-0')}
                src={visibleSchoolLogo}
                style={{
                  height: presentation.schoolLogoHeightPx,
                  marginRight: hasCenteredMedia ? undefined : presentation.photoGapPx,
                  top: hasCenteredMedia ? presentation.schoolLogoOffsetTopPx : undefined,
                  marginTop: hasCenteredMedia ? undefined : presentation.schoolLogoOffsetTopPx,
                  width: presentation.schoolLogoWidthPx,
                }}
              />
            ) : null}
            <div
              className={cn('min-w-0', hasCenteredMedia ? 'w-full' : 'flex-1')}
              style={{
                paddingLeft: hasCenteredMedia ? presentation.profileAvatarInsetPx : undefined,
                paddingRight: hasCenteredMedia ? presentation.profileAvatarInsetPx : undefined,
                textAlign: presentation.profileTextAlign,
              }}
            >
              {profile.fullName ? (
                <h1
                  className="font-bold"
                  style={{
                    color: presentation.bodyColor,
                    fontSize: formatting.nameFontSizePx,
                    letterSpacing: presentation.nameLetterSpacingPx,
                    lineHeight: presentation.nameLineHeight,
                  }}
                >
                  {profile.fullName}
                </h1>
              ) : null}
              {profile.targetRole ? (
                <p
                  style={{
                    color: presentation.bodyColor,
                    fontSize: formatting.bodyFontSizePx,
                    marginTop: presentation.roleMarginTopPx,
                  }}
                >
                  {formatTargetRole(profile.targetRole)}
                </p>
              ) : null}
              {contacts.length || printableLinks.length ? (
                <div
                  className={cn(
                    'flex flex-wrap',
                    profileAlignment === 'center' && 'justify-center',
                    profileAlignment === 'left' && 'justify-start',
                    profileAlignment === 'right' && 'justify-end',
                  )}
                  style={{
                    color: presentation.bodyColor,
                    columnGap: presentation.contactsColumnGapPx,
                    fontSize: formatting.bodyFontSizePx,
                    marginTop: presentation.contactsMarginTopPx,
                    rowGap: presentation.contactsRowGapPx,
                  }}
                >
                  {contacts.map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                  {printableLinks.map((link) => (
                    <Link
                      className="text-inherit no-underline hover:underline"
                      href={link.url}
                      key={link.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            {visibleAvatar && !avatarOnLeft ? (
              <img
                alt=""
                className={cn(
                  'shrink-0 object-contain',
                  hasCenteredMedia && 'absolute right-0 top-0',
                )}
                src={visibleAvatar}
                style={{
                  height: presentation.photoHeightPx,
                  marginLeft: hasCenteredMedia ? undefined : presentation.photoGapPx,
                  width: presentation.photoWidthPx,
                }}
              />
            ) : visibleSchoolLogo && !schoolLogoOnLeft ? (
              <img
                alt=""
                className={cn('shrink-0 object-contain', hasCenteredMedia && 'absolute right-0')}
                src={visibleSchoolLogo}
                style={{
                  height: presentation.schoolLogoHeightPx,
                  marginLeft: hasCenteredMedia ? undefined : presentation.photoGapPx,
                  top: hasCenteredMedia ? presentation.schoolLogoOffsetTopPx : undefined,
                  marginTop: hasCenteredMedia ? undefined : presentation.schoolLogoOffsetTopPx,
                  width: presentation.schoolLogoWidthPx,
                }}
              />
            ) : null}
          </header>
        ) : null}

        {printableSections.map((section, index) => (
          <HtmlSection
            flushTop={!hasPrintableProfile && index === 0}
            key={section.id}
            section={section}
            formatting={formatting}
            presentation={presentation}
          />
        ))}
      </article>
    </Card>
  );
});

function HtmlSection({
  flushTop,
  section,
  formatting,
  presentation,
}: {
  flushTop: boolean;
  section: ResumeSection;
  formatting: ResumeFormatting;
  presentation: ReturnType<typeof createResumePresentation>;
}) {
  return (
    <section
      className="break-inside-avoid"
      style={{
        marginTop: flushTop ? 0 : (section.spacingBeforePx ?? formatting.sectionGapPx),
      }}
    >
      <h2
        className="border-b font-bold tracking-[0.04em] text-[var(--resume-accent)]"
        style={{
          borderColor: 'var(--resume-accent)',
          fontSize: formatting.sectionTitleFontSizePx,
          paddingBottom: presentation.sectionTitlePaddingBottomPx,
        }}
      >
        {section.title}
      </h2>
      {section.type === 'summary' ? (
        <ResumeMarkdownHtml className="mt-[0.8em]" value={section.text} />
      ) : null}
      {section.type === 'skills' ? (
        <ResumeMarkdownHtml className="mt-[0.8em]" value={section.description} />
      ) : null}
      {section.type !== 'summary' && section.type !== 'skills' ? (
        <div className="pt-[0.8em]">
          {section.items.filter(itemHasPrintableContent).map((item, index) => {
            const display = getEntryDisplay(
              section.type,
              item as unknown as Record<string, unknown>,
            );
            return (
              <article
                className="break-inside-avoid"
                key={item.id}
                style={{
                  marginTop:
                    index > 0 ? (item.spacingBeforePx ?? formatting.entryGapPx) : undefined,
                }}
              >
                {display.title || display.date ? (
                  <div className="flex items-baseline justify-between gap-[1.5em]">
                    {display.title ? (
                      <h3
                        className="font-bold"
                        style={{ fontSize: formatting.entryTitleFontSizePx }}
                      >
                        {display.title}
                      </h3>
                    ) : (
                      <span />
                    )}
                    {display.date ? (
                      <time
                        className="shrink-0"
                        style={{ fontSize: formatting.entryTitleFontSizePx }}
                      >
                        {display.date}
                      </time>
                    ) : null}
                  </div>
                ) : null}
                {display.description.trim() ? (
                  <ResumeMarkdownHtml className="mt-[0.45em]" value={display.description} />
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
