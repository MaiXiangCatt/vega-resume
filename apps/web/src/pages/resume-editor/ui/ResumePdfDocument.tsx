import { Document, Font, Image, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { RESUME_FONT_FAMILIES, resolveAccentColor } from '../model/resume.model';
import {
  getEntryDisplay,
  itemHasPrintableContent,
  profileHasPrintableContent,
  sectionHasPrintableContent,
} from '../model/resume.preview';
import { createResumePresentation, formatTargetRole, pxToPt } from '../model/resume.presentation';
import type { ResumeDocument, ResumeFormatting, ResumeSection } from '../model/resume.types';
import { ResumeMarkdownPdf } from './ResumeMarkdownPdf';

Font.register({
  family: 'NotoSansSC',
  fonts: [
    { fontWeight: 400, src: '/fonts/NotoSansSC-Pdf-Regular.ttf' },
    { fontWeight: 700, src: '/fonts/NotoSansSC-Pdf-Bold.ttf' },
    { fontStyle: 'italic', fontWeight: 400, src: '/fonts/NotoSansSC-Pdf-Regular.ttf' },
    { fontStyle: 'italic', fontWeight: 700, src: '/fonts/NotoSansSC-Pdf-Bold.ttf' },
  ],
});
Font.register({
  family: 'NotoSerifSC',
  fonts: [
    { fontWeight: 400, src: '/fonts/NotoSerifSC-Pdf-Regular.ttf' },
    { fontWeight: 700, src: '/fonts/NotoSerifSC-Pdf-Bold.ttf' },
    { fontStyle: 'italic', fontWeight: 400, src: '/fonts/NotoSerifSC-Pdf-Regular.ttf' },
    { fontStyle: 'italic', fontWeight: 700, src: '/fonts/NotoSerifSC-Pdf-Bold.ttf' },
  ],
});

export function ResumePdfDocument({
  avatar,
  resume,
  schoolLogo = null,
}: {
  avatar: string | null;
  resume: ResumeDocument;
  schoolLogo?: string | null;
}) {
  const accent = resolveAccentColor(resume.content.formatting.accentColor);
  const profile = resume.content.profile;
  const visibleAvatar = profile.enabled ? avatar : null;
  const visibleSchoolLogo = profile.enabled ? schoolLogo : null;
  const profileAlignment = resume.profileAlignment;
  const formatting = resume.content.formatting;
  const base = pxToPt(formatting.bodyFontSizePx);
  const presentation = createResumePresentation(formatting, profileAlignment);
  const hasMedia = Boolean(visibleAvatar || visibleSchoolLogo);
  const hasCenteredMedia = profileAlignment === 'center' && hasMedia;
  const hasSideMedia = hasMedia && !hasCenteredMedia;
  const avatarOnLeft = profileAlignment === 'right';
  const schoolLogoOnLeft = !avatarOnLeft;
  const avatarLayout = createMediaLayout(
    hasCenteredMedia,
    avatarOnLeft,
    pxToPt(presentation.photoGapPx),
    0,
  );
  const schoolLogoLayout = createMediaLayout(
    hasCenteredMedia,
    schoolLogoOnLeft,
    pxToPt(presentation.photoGapPx),
    pxToPt(presentation.schoolLogoOffsetTopPx),
  );
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
      color: '#242126',
      fontFamily: RESUME_FONT_FAMILIES[formatting.fontFamily].pdfFamily,
      fontSize: base,
      lineHeight: formatting.lineHeightRatio,
      paddingBottom: pxToPt(formatting.pageMarginPx.bottom),
      paddingLeft: pxToPt(formatting.pageMarginPx.left),
      paddingRight: pxToPt(formatting.pageMarginPx.right),
      paddingTop: pxToPt(formatting.pageMarginPx.top),
    },
    header: {
      alignItems: hasSideMedia ? 'flex-start' : 'stretch',
      flexDirection: hasSideMedia ? 'row' : 'column',
      justifyContent: hasSideMedia ? 'space-between' : 'flex-start',
      minHeight: hasMedia
        ? pxToPt(presentation.photoHeightPx + presentation.headerPaddingBottomPx)
        : undefined,
      paddingBottom: pxToPt(presentation.headerPaddingBottomPx),
      position: hasCenteredMedia ? 'relative' : 'static',
    },
    identity: {
      ...(hasCenteredMedia
        ? {
            paddingLeft: pxToPt(presentation.profileAvatarInsetPx),
            paddingRight: pxToPt(presentation.profileAvatarInsetPx),
            width: '100%',
          }
        : {}),
      ...(hasSideMedia ? { flexBasis: 0, flexGrow: 1 } : {}),
    },
    name: {
      color: presentation.bodyColor,
      fontSize: pxToPt(formatting.nameFontSizePx),
      fontWeight: 700,
      letterSpacing: pxToPt(presentation.nameLetterSpacingPx),
      lineHeight: presentation.nameLineHeight,
      textAlign: presentation.profileTextAlign,
    },
    role: {
      color: presentation.bodyColor,
      fontSize: base,
      marginTop: pxToPt(presentation.roleMarginTopPx),
      textAlign: presentation.profileTextAlign,
    },
    contacts: {
      color: presentation.bodyColor,
      flexDirection: 'row',
      flexWrap: 'wrap',
      fontSize: base,
      columnGap: pxToPt(presentation.contactsColumnGapPx),
      justifyContent: justifyContentForAlignment(profileAlignment),
      marginTop: pxToPt(presentation.contactsMarginTopPx),
      rowGap: pxToPt(presentation.contactsRowGapPx),
    },
    politicalStatus: {
      color: presentation.bodyColor,
      fontSize: base,
      textAlign: presentation.profileTextAlign,
    },
    avatar: {
      height: pxToPt(presentation.photoHeightPx),
      objectFit: 'contain',
      ...avatarLayout,
      width: pxToPt(presentation.photoWidthPx),
    },
    schoolLogo: {
      height: pxToPt(presentation.schoolLogoHeightPx),
      objectFit: 'contain',
      ...schoolLogoLayout,
      width: pxToPt(presentation.schoolLogoWidthPx),
    },
    section: {},
    sectionTitle: {
      borderBottomColor: accent,
      borderBottomWidth: 0.65,
      color: accent,
      fontSize: pxToPt(formatting.sectionTitleFontSizePx),
      fontWeight: 700,
      letterSpacing: 0.5,
      paddingBottom: pxToPt(presentation.sectionTitlePaddingBottomPx),
    },
    sectionContent: { marginTop: pxToPt(presentation.sectionContentMarginTopPx) },
    entries: { marginTop: pxToPt(presentation.sectionContentMarginTopPx) },
    entry: {},
    entryHead: { flexDirection: 'row', justifyContent: 'space-between' },
    entryTitle: { fontSize: pxToPt(formatting.entryTitleFontSizePx), fontWeight: 700 },
    entryDate: { fontSize: pxToPt(formatting.entryTitleFontSizePx) },
    entryDescription: { marginTop: pxToPt(presentation.entryDescriptionMarginTopPx) },
    link: { color: presentation.bodyColor, textDecoration: 'none' },
  });

  const contacts = [profile.phone, profile.email, profile.location].filter(Boolean);
  const politicalStatus = profile.politicalStatus.trim();
  const hasPrintableContacts = Boolean(
    contacts.length || profile.links.some((item) => item.label && item.url),
  );
  const hasPrintableProfile = profileHasPrintableContent(
    profile,
    Boolean(visibleAvatar),
    Boolean(visibleSchoolLogo),
  );
  const printableSections = resume.content.sections.filter(sectionHasPrintableContent);

  return (
    <Document
      author={profile.enabled ? profile.fullName || 'LittleAgResume' : 'LittleAgResume'}
      subject={profile.enabled ? profile.targetRole : ''}
      title={profile.enabled ? resume.title : '简历'}
    >
      <Page size="A4" style={styles.page} wrap>
        {hasPrintableProfile ? (
          <View style={styles.header}>
            {visibleAvatar && avatarOnLeft ? (
              <Image src={visibleAvatar} style={styles.avatar} />
            ) : visibleSchoolLogo && schoolLogoOnLeft ? (
              <Image src={visibleSchoolLogo} style={styles.schoolLogo} />
            ) : null}
            <View style={styles.identity}>
              {profile.fullName ? <Text style={styles.name}>{profile.fullName}</Text> : null}
              {profile.targetRole ? (
                <Text style={styles.role}>{formatTargetRole(profile.targetRole)}</Text>
              ) : null}
              {contacts.length || profile.links.some((item) => item.label && item.url) ? (
                <View style={styles.contacts}>
                  {contacts.map((value) => (
                    <Text key={value}>{value}</Text>
                  ))}
                  {profile.links
                    .filter((item) => item.label && item.url)
                    .map((item) => (
                      <Link key={item.id} src={item.url} style={styles.link}>
                        {item.label}
                      </Link>
                    ))}
                </View>
              ) : null}
              {politicalStatus ? (
                <Text
                  style={[
                    styles.politicalStatus,
                    {
                      marginTop: pxToPt(
                        hasPrintableContacts
                          ? presentation.contactsRowGapPx
                          : presentation.contactsMarginTopPx,
                      ),
                    },
                  ]}
                >
                  政治面貌：{politicalStatus}
                </Text>
              ) : null}
            </View>
            {visibleAvatar && !avatarOnLeft ? (
              <Image src={visibleAvatar} style={styles.avatar} />
            ) : visibleSchoolLogo && !schoolLogoOnLeft ? (
              <Image src={visibleSchoolLogo} style={styles.schoolLogo} />
            ) : null}
          </View>
        ) : null}
        {printableSections.map((section, index) => (
          <PdfSection
            accent={accent}
            flushTop={!hasPrintableProfile && index === 0}
            formatting={formatting}
            key={section.id}
            section={section}
            styles={styles}
          />
        ))}
      </Page>
    </Document>
  );
}

function justifyContentForAlignment(
  alignment: ResumeDocument['profileAlignment'],
): 'center' | 'flex-end' | 'flex-start' {
  switch (alignment) {
    case 'center':
      return 'center';
    case 'right':
      return 'flex-end';
    default:
      return 'flex-start';
  }
}

function createMediaLayout(hasCenteredMedia: boolean, onLeft: boolean, gap: number, top: number) {
  if (hasCenteredMedia) {
    return { position: 'absolute' as const, ...(onLeft ? { left: 0 } : { right: 0 }), top };
  }
  if (onLeft) return { marginRight: gap, marginTop: top };
  return { marginLeft: gap, marginTop: top };
}

function PdfSection({
  accent,
  flushTop,
  formatting,
  section,
  styles,
}: {
  accent: string;
  flushTop: boolean;
  formatting: ResumeFormatting;
  section: ResumeSection;
  styles: ReturnType<typeof StyleSheet.create>;
}) {
  if (!sectionHasPrintableContent(section)) return null;
  if (section.type === 'summary' || section.type === 'skills') {
    const markdown = section.type === 'summary' ? section.text : section.description;
    return (
      <View
        style={[
          styles.section,
          {
            marginTop: flushTop ? 0 : pxToPt(section.spacingBeforePx ?? formatting.sectionGapPx),
          },
        ]}
        minPresenceAhead={40}
      >
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <View style={styles.sectionContent}>
          <ResumeMarkdownPdf
            accent={accent}
            bodyFontSizePx={formatting.bodyFontSizePx}
            value={markdown}
          />
        </View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.section,
        {
          marginTop: flushTop ? 0 : pxToPt(section.spacingBeforePx ?? formatting.sectionGapPx),
        },
      ]}
      minPresenceAhead={55}
    >
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <View style={styles.entries}>
        {section.items.filter(itemHasPrintableContent).map((item, index) => {
          const display = getEntryDisplay(section.type, item as Record<string, unknown>);
          return (
            <View
              key={item.id}
              style={
                index > 0
                  ? [
                      styles.entry,
                      {
                        marginTop: pxToPt(item.spacingBeforePx ?? formatting.entryGapPx),
                      },
                    ]
                  : styles.entry
              }
            >
              <View style={styles.entryHead}>
                <Text style={styles.entryTitle}>{display.title}</Text>
                <Text style={styles.entryDate}>{display.date}</Text>
              </View>
              {display.description.trim() ? (
                <View style={styles.entryDescription}>
                  <ResumeMarkdownPdf
                    accent={accent}
                    bodyFontSizePx={formatting.bodyFontSizePx}
                    value={display.description}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
