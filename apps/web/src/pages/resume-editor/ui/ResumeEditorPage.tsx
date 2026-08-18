import { useDeferredValue, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  HardDrive,
  LoaderCircle,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuthStore } from '@/shared/auth/store/auth.store';
import { useAnalyticsWorkspace, useTrackAnalytics } from '@/shared/analytics/hooks/useAnalytics';
import { useAnalyticsStore } from '@/shared/analytics/store/analytics.store';
import { ApiError } from '@/shared/http/http.client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogDragHandle,
  DialogFooter,
  DialogTitle,
} from '@/shared/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { useResumeEditor } from '../hooks/useResumeEditor';
import { useLocalResumeStatus } from '../hooks/useLocalResumeStatus';
import type { ResumeEditorMode } from '../model/resume.editor';
import {
  ACCENT_COLORS,
  completionIssues,
  createCustomSection,
  createDefaultFormatting,
  parseImportEnvelope,
  RESUME_FONT_FAMILIES,
  resolveAccentColor,
} from '../model/resume.model';
import type {
  AccentColor,
  PresetAccentColor,
  ProfileAlignment,
  ResumeDocument,
  ResumeFontFamily,
  ResumeFormatting,
  ResumeImportEnvelope,
  ResumeSection,
} from '../model/resume.types';
import { useResumeEditorStore } from '../store/resume-editor.store';
import { localResumeStore } from '../store/local-resume.store';
import { AvatarCropDialog } from './AvatarCropDialog';
import { ProfileEditor, SectionEditor } from './EditorForms';
import { LocalPdfPreview } from './LocalPdfPreview';
import { ResumeHtmlPreview } from './ResumeHtmlPreview';
import { SchoolLogoCropDialog } from './SchoolLogoCropDialog';
import { StructurePanel } from './StructurePanel';

export function ResumeEditorPage({
  resumeId,
  mode = 'cloud',
}: {
  resumeId: string;
  mode?: ResumeEditorMode;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const document = useResumeEditorStore((state) => state.document);
  const error = useResumeEditorStore((state) => state.error);
  const isLoading = useResumeEditorStore((state) => state.isLoading);
  const saveStatus = useResumeEditorStore((state) => state.saveStatus);
  const localStorage = useLocalResumeStatus();
  const {
    avatarUrl,
    deleteAvatar: removeAvatar,
    deleteSchoolLogo: removeSchoolLogo,
    durability,
    edit,
    exportPdf,
    flushSave,
    getAvatarDataUrl,
    getSchoolLogoDataUrl,
    load,
    overwrite,
    pdfPreview,
    reload,
    replaceImport,
    retryStorage,
    saveAvatar: persistAvatar,
    saveSchoolLogo: persistSchoolLogo,
    schoolLogoUrl,
  } = useResumeEditor(resumeId, mode);
  const [activeId, setActiveId] = useState('profile');
  const [formatOpen, setFormatOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [schoolLogoCropSource, setSchoolLogoCropSource] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ResumeSection | null>(null);
  const [importEnvelope, setImportEnvelope] = useState<ResumeImportEnvelope | null>(null);
  const [issues, setIssues] = useState<{ mode: 'complete' | 'export'; values: string[] } | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [clearLocalDataOpen, setClearLocalDataOpen] = useState(false);
  const [isClearingLocalData, setClearingLocalData] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const schoolLogoInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const analyticsEnabled = useAnalyticsStore((state) => state.enabled);
  const openPrivacySettings = useAnalyticsStore((state) => state.openSettings);
  const trackAnalytics = useTrackAnalytics();

  const deferredDocument = useDeferredValue(document);
  const isReadOnly = mode === 'local' && durability === 'read-only';
  const visibleAvatar = document?.hasAvatar ? avatarUrl : null;
  const visibleSchoolLogo = document?.hasSchoolLogo ? schoolLogoUrl : null;
  const activeSection =
    document?.content.sections.find((section) => section.id === activeId) ?? null;
  useAnalyticsWorkspace(mode, !isLoading && Boolean(document));

  function openPrivacySettingsFromMenu() {
    window.setTimeout(openPrivacySettings, 0);
  }

  function retryReadOnlyStorage() {
    setFormatOpen(false);
    setAddOpen(false);
    setPendingRemove(null);
    setImportEnvelope(null);
    if (cropSource) {
      URL.revokeObjectURL(cropSource);
      setCropSource(null);
    }
    if (schoolLogoCropSource) {
      URL.revokeObjectURL(schoolLogoCropSource);
      setSchoolLogoCropSource(null);
    }
    void retryStorage();
  }

  function mutate(mutator: (draft: ResumeDocument) => void, immediate = false) {
    edit((current) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    }, immediate);
  }

  function returnFromEditor() {
    if (
      ['dirty', 'saving', 'failed', 'conflict'].includes(
        useResumeEditorStore.getState().saveStatus,
      ) ||
      isReadOnly
    ) {
      setExitConfirmationOpen(true);
      return;
    }
    navigate(mode === 'local' ? '/local' : '/console');
  }

  function updateSection(section: ResumeSection, immediate = false) {
    mutate((draft) => {
      draft.content.sections = draft.content.sections.map((item) =>
        item.id === section.id ? section : item,
      );
    }, immediate);
  }

  function requestRemove(section: ResumeSection) {
    if (section.type !== 'custom') return;
    setPendingRemove(section);
  }

  function toggleProfileVisibility() {
    mutate((draft) => {
      draft.content.profile.enabled = !draft.content.profile.enabled;
    }, true);
  }

  function toggleSectionVisibility(section: ResumeSection) {
    mutate((draft) => {
      const target = draft.content.sections.find((item) => item.id === section.id);
      if (target) target.enabled = !target.enabled;
    }, true);
  }

  function addCustom() {
    if (!customName.trim()) return;
    const section = createCustomSection(customName);
    mutate((draft) => {
      draft.content.sections.push(section);
    }, true);
    setActiveId(section.id);
    setCustomName('');
    setAddOpen(false);
  }

  async function saveAvatar(blob: Blob) {
    try {
      await persistAvatar(blob);
      setCropSource(null);
      toast.success(mode === 'local' ? '头像已保存到本机' : '头像已更新');
    } catch {
      toast.error('头像保存失败，请稍后重试');
    }
  }

  async function deleteAvatar() {
    try {
      await removeAvatar();
      toast.success('头像已删除');
    } catch {
      toast.error('头像删除失败，请稍后重试');
    }
  }

  async function saveSchoolLogo(blob: Blob) {
    try {
      await persistSchoolLogo(blob);
      setSchoolLogoCropSource(null);
      toast.success(mode === 'local' ? '校徽已保存到本机' : '校徽已更新');
    } catch {
      toast.error('校徽保存失败，请稍后重试');
    }
  }

  async function deleteSchoolLogo() {
    try {
      await removeSchoolLogo();
      toast.success('校徽已删除');
    } catch {
      toast.error('校徽删除失败，请稍后重试');
    }
  }

  async function readImport(file: File) {
    try {
      setImportEnvelope(parseImportEnvelope(JSON.parse(await file.text())));
    } catch {
      toast.error('文件格式不正确，需要 LittleAgResume v2 JSON 文件');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  async function confirmImport() {
    if (!importEnvelope) return;
    try {
      await replaceImport(importEnvelope);
      trackAnalytics('resume_imported', mode);
      setImportEnvelope(null);
      setActiveId('profile');
      toast.success('简历已导入');
    } catch {
      toast.error('导入失败，当前简历未被替换');
    }
  }

  async function exportJson() {
    if (!document) return;
    const envelope: ResumeImportEnvelope = {
      version: 4,
      title: document.title,
      profileAlignment: document.profileAlignment,
      content: document.content,
      avatar: await getAvatarDataUrl(),
      schoolLogo: await getSchoolLogoDataUrl(),
    };
    downloadBlob(
      new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }),
      `${safeFileName(document.title)}.json`,
    );
    trackAnalytics('resume_exported_json', mode);
  }

  async function runPdfExport() {
    const current = useResumeEditorStore.getState().document;
    if (!current || exporting) return;
    let downloaded = false;
    setIssues(null);
    setExporting(true);
    try {
      downloadBlob(await exportPdf(), `${safeFileName(current.title)}.pdf`);
      downloaded = true;
      trackAnalytics('resume_exported_pdf', mode);
      const finalSaveStatus = useResumeEditorStore.getState().saveStatus;
      if (finalSaveStatus === 'failed' || finalSaveStatus === 'conflict') {
        toast.warning('PDF 已开始下载；当前修改仍未保存');
      } else {
        toast.success('PDF 已开始下载');
      }
    } catch (error) {
      if (downloaded) {
        toast.warning('PDF 已开始下载，但导出记录更新失败');
      } else if (mode === 'cloud' && error instanceof ApiError && error.code === 106002) {
        toast.error('PDF 服务繁忙，请稍后重试');
      } else {
        toast.error('PDF 生成失败，请检查内容后重试');
      }
    } finally {
      setExporting(false);
    }
  }

  function requestExport() {
    if (!document) return;
    const values = completionIssues(document.content, document.hasAvatar, document.hasSchoolLogo);
    if (values.length) setIssues({ mode: 'export', values });
    else void runPdfExport();
  }

  function toggleComplete() {
    if (!document) return;
    if (document.status === 'completed') {
      mutate((draft) => {
        draft.status = 'draft';
      }, true);
      return;
    }
    const values = completionIssues(document.content, document.hasAvatar, document.hasSchoolLogo);
    if (values.length) setIssues({ mode: 'complete', values });
    else
      mutate((draft) => {
        draft.status = 'completed';
      }, true);
  }

  async function retryInitialStorage() {
    try {
      await localResumeStore.retry();
      await load();
    } catch {
      // The shared local store keeps the blocking error visible.
    }
  }

  async function clearBlockedLocalData() {
    if (isClearingLocalData) return;
    setClearingLocalData(true);
    try {
      await localResumeStore.clear();
      navigate('/local', { replace: true });
    } catch {
      toast.error('清除本地数据失败，请关闭其他页面后重试');
      setClearingLocalData(false);
    }
  }

  if (isLoading) return <EditorLoading />;
  if (!document)
    return (
      <>
        <EditorFailure
          message={error ?? '无法加载简历'}
          onBack={() => navigate(mode === 'local' ? '/local' : '/console')}
          onClear={
            mode === 'local' && localStorage.availability === 'blocked'
              ? () => setClearLocalDataOpen(true)
              : undefined
          }
          onRetry={() => void (mode === 'local' ? retryInitialStorage() : load())}
          returnLabel={mode === 'local' ? '返回本地控制台' : '返回控制台'}
        />
        {clearLocalDataOpen ? (
          <Dialog onOpenChange={setClearLocalDataOpen} open>
            <DialogContent className="rounded-2xl p-6">
              <DialogTitle>清除全部本地简历？</DialogTitle>
              <DialogDescription>
                这会永久删除当前浏览器中的全部本地简历和头像，且无法恢复。
              </DialogDescription>
              <DialogFooter>
                <Button
                  disabled={isClearingLocalData}
                  onClick={() => setClearLocalDataOpen(false)}
                  variant="outline"
                >
                  取消
                </Button>
                <Button
                  disabled={isClearingLocalData}
                  onClick={() => void clearBlockedLocalData()}
                  variant="destructive"
                >
                  {isClearingLocalData ? '正在清除…' : '确认清除'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </>
    );

  return (
    <div className="min-w-[1240px] bg-[#f2eeef] text-[#251d23]">
      <header className="flex h-[72px] items-center border-b border-[#ded6da] bg-[#fffdfd] px-5 shadow-[0_1px_0_rgba(52,38,47,0.04)]">
        <Button
          aria-label={mode === 'local' ? '返回本地控制台' : '返回控制台'}
          onClick={returnFromEditor}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft size={19} />
        </Button>
        <div className="ml-3 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#bf301e] font-serif text-lg font-bold text-white">
            R
          </span>
          <span className="font-serif text-lg font-semibold">LittleAgResume</span>
        </div>
        {mode === 'local' ? (
          <span className="ml-3 rounded-full border border-[#e5bbb4] bg-[#fbeeea] px-3 py-1 text-xs font-semibold text-[#bf301e]">
            本地模式
          </span>
        ) : null}
        <div className="mx-5 h-7 w-px bg-[#e2dadd]" />
        <Input
          aria-label="简历标题"
          className="h-10 w-72 border-transparent bg-transparent px-2 text-base font-semibold shadow-none hover:border-[#ddd4d9] focus-visible:bg-white"
          disabled={isReadOnly}
          value={document.title}
          onChange={(event) =>
            mutate((draft) => {
              draft.title = event.target.value;
            })
          }
        />
        <SaveBadge durability={durability} mode={mode} status={saveStatus} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            disabled={isReadOnly}
            onClick={toggleComplete}
            variant={document.status === 'completed' ? 'default' : 'outline'}
          >
            {document.status === 'completed' ? <Check size={16} /> : null}
            {document.status === 'completed' ? '已完成' : '标记完成'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FileDown size={16} />
                JSON
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isReadOnly} onClick={() => importInput.current?.click()}>
                <FileUp />
                导入并覆盖
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportJson()}>
                <FileDown />
                <span>
                  <span className="block">导出 JSON 备份</span>
                  <span className="block text-[11px] font-normal text-[#8f828a]">
                    包含隐藏内容，不适合匿名分享
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            accept=".json,application/json"
            hidden
            ref={importInput}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readImport(file);
            }}
          />
          <Button
            disabled={saveStatus === 'saving'}
            onClick={() => (isReadOnly ? retryReadOnlyStorage() : void flushSave())}
            variant="outline"
          >
            <Save size={16} />
            {isReadOnly ? '重试保存' : '立即保存'}
          </Button>
          <Button
            className="bg-[#bf301e] px-5 hover:bg-[#9f2718]"
            disabled={exporting}
            onClick={requestExport}
          >
            {exporting ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Download size={16} />
            )}
            {exporting ? '生成中…' : '导出 PDF'}
          </Button>
          {mode === 'cloud' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="账号菜单"
                  className="ml-1 rounded-full"
                  size="icon"
                  variant="ghost"
                >
                  <UserRound size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={returnFromEditor}>我的控制台</DropdownMenuItem>
                {analyticsEnabled ? (
                  <DropdownMenuItem onClick={openPrivacySettingsFromMenu}>
                    <ShieldCheck aria-hidden="true" />
                    隐私设置
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem disabled>{user?.username ?? '当前账号'}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {analyticsEnabled ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="ml-1 rounded-full" variant="ghost">
                      <HardDrive size={14} />
                      仅存此浏览器
                      <ChevronDown size={13} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={openPrivacySettingsFromMenu}>
                      <ShieldCheck aria-hidden="true" />
                      隐私设置
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="ml-1 flex items-center gap-2 rounded-full bg-[#f9efec] px-3 py-2 text-xs font-medium text-[#77524c]">
                  <HardDrive size={14} />
                  仅存此浏览器
                </div>
              )}
            </>
          )}
        </div>
      </header>
      {isReadOnly ? (
        <div
          className="flex h-10 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-5 text-sm font-medium text-amber-900"
          role="alert"
        >
          <AlertTriangle size={15} />
          浏览器本地存储暂时不可写；编辑已冻结，当前画面中的修改可能尚未保存，请先导出 JSON 或重试。
          <Button
            className="h-7 bg-white px-2.5"
            onClick={retryReadOnlyStorage}
            size="sm"
            type="button"
            variant="outline"
          >
            重试存储
          </Button>
        </div>
      ) : null}
      <main
        className={cn(
          'grid grid-cols-[236px_minmax(430px,0.9fr)_minmax(520px,1.1fr)] overflow-hidden',
          isReadOnly ? 'h-[calc(100vh-112px)]' : 'h-[calc(100vh-72px)]',
        )}
      >
        <div
          aria-disabled={isReadOnly}
          className={cn(isReadOnly && 'pointer-events-none opacity-70')}
        >
          <StructurePanel
            activeId={activeId}
            hasAvatar={document.hasAvatar}
            hasSchoolLogo={document.hasSchoolLogo}
            onAdd={() => setAddOpen(true)}
            onFormat={() => setFormatOpen(true)}
            onMove={(sections) =>
              mutate((draft) => {
                draft.content.sections = sections;
              }, true)
            }
            onRemove={requestRemove}
            onSelect={setActiveId}
            onToggleProfile={toggleProfileVisibility}
            onToggleSection={toggleSectionVisibility}
            profile={document.content.profile}
            sections={document.content.sections}
          />
        </div>
        <section
          aria-disabled={isReadOnly}
          className={cn(
            'overflow-y-auto bg-[#fffdfd] px-8 py-9',
            isReadOnly && 'pointer-events-none opacity-70',
          )}
        >
          {activeId === 'profile' && !document.content.profile.enabled ? (
            <VisibilityNotice label="基本信息" onRestore={toggleProfileVisibility} />
          ) : activeSection && !activeSection.enabled ? (
            <VisibilityNotice
              label={activeSection.title}
              onRestore={() => toggleSectionVisibility(activeSection)}
            />
          ) : null}
          {activeId === 'profile' ? (
            <ProfileEditor
              avatar={visibleAvatar}
              onAvatar={() => avatarInput.current?.click()}
              onChange={(profile) =>
                mutate((draft) => {
                  draft.content.profile = profile;
                })
              }
              onDeleteAvatar={() => void deleteAvatar()}
              onDeleteSchoolLogo={() => void deleteSchoolLogo()}
              onSchoolLogo={() => schoolLogoInput.current?.click()}
              profile={document.content.profile}
              schoolLogo={visibleSchoolLogo}
            />
          ) : activeSection ? (
            <SectionEditor
              defaultEntryGapPx={document.content.formatting.entryGapPx}
              defaultSectionGapPx={document.content.formatting.sectionGapPx}
              onChange={(section) => updateSection(section)}
              section={activeSection}
            />
          ) : null}
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="上传头像原图"
            hidden
            ref={avatarInput}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && file.size <= 5 * 1024 * 1024) setCropSource(URL.createObjectURL(file));
              else if (file) toast.error('原图不能超过 5 MB');
              event.target.value = '';
            }}
          />
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="上传校徽原图"
            hidden
            ref={schoolLogoInput}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && file.size <= 5 * 1024 * 1024)
                setSchoolLogoCropSource(URL.createObjectURL(file));
              else if (file) toast.error('原图不能超过 5 MB');
              event.target.value = '';
            }}
          />
        </section>
        <section
          className={cn(
            'relative bg-[#d9d3d5] px-7 py-10',
            mode === 'local' ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {mode === 'local' ? (
            <LocalPdfPreview preview={pdfPreview} />
          ) : deferredDocument ? (
            <ResumeHtmlPreview
              avatar={visibleAvatar}
              resume={deferredDocument}
              schoolLogo={visibleSchoolLogo}
            />
          ) : null}
        </section>
      </main>

      {formatOpen && !isReadOnly ? (
        <FormattingDialog
          document={document}
          onChange={(formatting) =>
            mutate((draft) => {
              draft.content.formatting = formatting;
            })
          }
          onClose={() => {
            setFormatOpen(false);
            void flushSave();
          }}
          onProfileAlignment={(profileAlignment) =>
            mutate((draft) => {
              draft.profileAlignment = profileAlignment;
            }, true)
          }
        />
      ) : null}
      {addOpen && !isReadOnly ? (
        <AddSectionDialog
          customName={customName}
          onAddCustom={addCustom}
          onChangeName={setCustomName}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
      {cropSource && !isReadOnly ? (
        <AvatarCropDialog
          image={cropSource}
          onClose={() => {
            URL.revokeObjectURL(cropSource);
            setCropSource(null);
          }}
          onSave={saveAvatar}
        />
      ) : null}
      {schoolLogoCropSource && !isReadOnly ? (
        <SchoolLogoCropDialog
          image={schoolLogoCropSource}
          onClose={() => {
            URL.revokeObjectURL(schoolLogoCropSource);
            setSchoolLogoCropSource(null);
          }}
          onSave={saveSchoolLogo}
        />
      ) : null}
      {pendingRemove && !isReadOnly ? (
        <ConfirmDialog
          description={`删除“${pendingRemove.title}”后不可恢复。`}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            mutate((draft) => {
              draft.content.sections = draft.content.sections.filter(
                (item) => item.id !== pendingRemove.id,
              );
            }, true);
            setPendingRemove(null);
            setActiveId('profile');
          }}
          title="删除自定义板块？"
        />
      ) : null}
      {importEnvelope && !isReadOnly ? (
        <ConfirmDialog
          description={`将用“${importEnvelope.title}”覆盖当前简历，共 ${importEnvelope.content.sections.filter((item) => item.enabled).length} 个启用板块。`}
          onCancel={() => setImportEnvelope(null)}
          onConfirm={() => void confirmImport()}
          title="确认覆盖当前简历？"
        />
      ) : null}
      {saveStatus === 'conflict' ? (
        <ConflictDialog
          allowOverwrite={!isReadOnly}
          mode={mode}
          onOverwrite={() => void overwrite()}
          onReload={reload}
        />
      ) : null}
      {issues ? (
        <IssuesDialog
          issues={issues.values}
          mode={issues.mode}
          onCancel={() => setIssues(null)}
          onContinue={() => {
            if (issues.mode === 'export') void runPdfExport();
            setIssues(null);
          }}
        />
      ) : null}
      {exitConfirmationOpen ? (
        <ConfirmDialog
          description="当前修改尚未安全保存，离开后会丢失这些内容。"
          onCancel={() => setExitConfirmationOpen(false)}
          onConfirm={() => navigate(mode === 'local' ? '/local' : '/console')}
          title="仍然离开编辑器？"
        />
      ) : null}
    </div>
  );
}

function SaveBadge({
  durability,
  mode,
  status,
}: {
  durability: ReturnType<typeof useResumeEditorStore.getState>['durability'];
  mode: ResumeEditorMode;
  status: ReturnType<typeof useResumeEditorStore.getState>['saveStatus'];
}) {
  const labels = {
    idle: '等待保存',
    dirty: '有未保存修改',
    saving: '保存中',
    saved: mode === 'local' ? '已保存到本机' : '已保存',
    failed: '保存失败',
    conflict: '版本冲突',
  };
  return (
    <span
      className={cn(
        'ml-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs',
        saveBadgeColor(status),
      )}
    >
      {status === 'saving' ? <LoaderCircle className="animate-spin" size={12} /> : null}
      {durability === 'read-only' ? '只读恢复' : labels[status]}
    </span>
  );
}

function saveBadgeColor(status: ReturnType<typeof useResumeEditorStore.getState>['saveStatus']) {
  if (status === 'saved') return 'bg-emerald-50 text-emerald-700';
  if (status === 'failed' || status === 'conflict') return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-700';
}

const ACCENT_COLOR_LABELS: Record<PresetAccentColor, string> = {
  plum: '梅紫',
  navy: '藏蓝',
  teal: '青绿',
  rust: '铁锈',
  charcoal: '炭灰',
  black: '纯黑',
};

export function FormattingDialog({
  document,
  onChange,
  onClose,
  onProfileAlignment,
}: {
  document: ResumeDocument;
  onChange: (formatting: ResumeFormatting) => void;
  onClose: () => void;
  onProfileAlignment: (value: ProfileAlignment) => void;
}) {
  const formatting = document.content.formatting;
  const [fieldRevision, setFieldRevision] = useState(0);
  const update = (changes: Partial<ResumeFormatting>) => onChange({ ...formatting, ...changes });
  const updateMargin = (side: keyof ResumeFormatting['pageMarginPx'], value: number) =>
    update({ pageMarginPx: { ...formatting.pageMarginPx, [side]: value } });
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        className="flex max-h-[88vh] w-[min(92vw,680px)] flex-col overflow-hidden rounded-3xl p-0"
        draggable
        overlayClassName="bg-transparent"
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-[#eee7eb] bg-white px-7 py-5 pr-12">
          <DialogDragHandle aria-label="拖动排版设置弹窗" className="-ml-2 mt-0.5" />
          <div className="min-w-0">
            <DialogTitle className="font-serif text-2xl">排版设置</DialogTitle>
            <DialogDescription>
              所有数值都会实时应用到预览与导出的 PDF；恢复默认不会清除模块和记录的单独设置。
            </DialogDescription>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-7 pb-7" data-slot="formatting-dialog-body">
          <div className="mt-5 grid grid-cols-2 gap-4 rounded-2xl border border-[#e8e0e5] bg-[#fbf9fa] p-4">
            <SelectField
              label="基本信息布局"
              value={document.profileAlignment}
              onChange={(value) => onProfileAlignment(value as ProfileAlignment)}
              options={[
                ['left', '左侧对齐'],
                ['center', '居中对齐'],
                ['right', '右侧对齐'],
              ]}
            />
            <SelectField
              label="字体"
              value={formatting.fontFamily}
              onChange={(value) => update({ fontFamily: value as ResumeFontFamily })}
              options={[
                ['source-han-sans', RESUME_FONT_FAMILIES['source-han-sans'].label],
                ['source-han-serif', RESUME_FONT_FAMILIES['source-han-serif'].label],
              ]}
            />
            <div className="col-span-2">
              <div className="flex items-center justify-between gap-4">
                <Label>主题色</Label>
                <span className="font-mono text-xs uppercase text-[#766a72]">
                  {resolveAccentColor(formatting.accentColor)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(Object.entries(ACCENT_COLORS) as [PresetAccentColor, string][]).map(
                  ([key, color]) => (
                    <Button
                      aria-label={`选择${ACCENT_COLOR_LABELS[key]}主题色`}
                      className={cn(
                        'size-8 rounded-full border-[3px] p-0',
                        resolveAccentColor(formatting.accentColor).toLowerCase() ===
                          color.toLowerCase()
                          ? 'border-[#241b21]'
                          : 'border-white',
                      )}
                      key={key}
                      onClick={() => update({ accentColor: key })}
                      style={{ backgroundColor: color }}
                    />
                  ),
                )}
                <div className="ml-1 flex items-center gap-2 border-l border-[#ddd4d9] pl-3">
                  <Input
                    aria-label="自定义主题色"
                    className="h-8 w-11 cursor-pointer rounded-lg border-0 bg-transparent p-0 shadow-none"
                    onChange={(event) => update({ accentColor: event.target.value as AccentColor })}
                    type="color"
                    value={resolveAccentColor(formatting.accentColor)}
                  />
                  <span className="text-xs text-[#766a72]">自定义</span>
                </div>
              </div>
            </div>
          </div>
          <div key={fieldRevision}>
            <FormattingSection
              description="四类文字角色全局生效，基本信息对齐方式不会覆盖这些数值。"
              title="字号"
            >
              <div className="grid grid-cols-2 gap-4">
                <NumericField
                  label="姓名"
                  maximum={48}
                  minimum={12}
                  onChange={(value) => update({ nameFontSizePx: value })}
                  suffix="px"
                  value={formatting.nameFontSizePx}
                />
                <NumericField
                  label="模块标题"
                  maximum={32}
                  minimum={10}
                  onChange={(value) => update({ sectionTitleFontSizePx: value })}
                  suffix="px"
                  value={formatting.sectionTitleFontSizePx}
                />
                <NumericField
                  label="条目标题"
                  maximum={28}
                  minimum={8}
                  onChange={(value) => update({ entryTitleFontSizePx: value })}
                  suffix="px"
                  value={formatting.entryTitleFontSizePx}
                />
                <NumericField
                  label="正文"
                  maximum={24}
                  minimum={8}
                  onChange={(value) => update({ bodyFontSizePx: value })}
                  suffix="px"
                  value={formatting.bodyFontSizePx}
                />
              </div>
            </FormattingSection>
            <FormattingSection
              description="行高使用倍数；默认间距可由具体模块或记录单独覆盖。"
              title="阅读节奏"
            >
              <div className="grid grid-cols-3 gap-4">
                <NumericField
                  label="行高"
                  maximum={2.5}
                  minimum={1}
                  onChange={(value) => update({ lineHeightRatio: value })}
                  step={0.05}
                  suffix="×"
                  value={formatting.lineHeightRatio}
                />
                <NumericField
                  label="默认模块间距"
                  maximum={64}
                  minimum={0}
                  onChange={(value) => update({ sectionGapPx: value })}
                  suffix="px"
                  value={formatting.sectionGapPx}
                />
                <NumericField
                  label="默认记录间距"
                  maximum={64}
                  minimum={0}
                  onChange={(value) => update({ entryGapPx: value })}
                  suffix="px"
                  value={formatting.entryGapPx}
                />
              </div>
            </FormattingSection>
            <FormattingSection
              description="四个方向独立控制，数值对应 A4 纸张内容到纸边的距离。"
              title="页边距"
            >
              <div className="grid grid-cols-[1fr_110px_1fr] grid-rows-[auto_76px_auto] items-center gap-3">
                <div className="col-start-2">
                  <NumericField
                    label="上"
                    maximum={160}
                    minimum={0}
                    onChange={(value) => updateMargin('top', value)}
                    suffix="px"
                    value={formatting.pageMarginPx.top}
                  />
                </div>
                <div className="col-start-1 row-start-2">
                  <NumericField
                    label="左"
                    maximum={160}
                    minimum={0}
                    onChange={(value) => updateMargin('left', value)}
                    suffix="px"
                    value={formatting.pageMarginPx.left}
                  />
                </div>
                <div
                  aria-hidden="true"
                  className="col-start-2 row-start-2 mx-auto h-16 w-11 rounded-sm border border-[#d8ccd4] bg-white shadow-[0_7px_18px_rgba(54,39,49,0.12)]"
                />
                <div className="col-start-3 row-start-2">
                  <NumericField
                    label="右"
                    maximum={160}
                    minimum={0}
                    onChange={(value) => updateMargin('right', value)}
                    suffix="px"
                    value={formatting.pageMarginPx.right}
                  />
                </div>
                <div className="col-start-2 row-start-3">
                  <NumericField
                    label="下"
                    maximum={160}
                    minimum={0}
                    onChange={(value) => updateMargin('bottom', value)}
                    suffix="px"
                    value={formatting.pageMarginPx.bottom}
                  />
                </div>
              </div>
            </FormattingSection>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                onChange(createDefaultFormatting());
                onProfileAlignment('left');
                setFieldRevision((revision) => revision + 1);
              }}
              variant="outline"
            >
              恢复默认
            </Button>
            <Button onClick={onClose}>完成</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormattingSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="mt-5 rounded-2xl border border-[#e8e0e5] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#3d3038]">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-[#8a7d86]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function NumericField({
  label,
  maximum,
  minimum,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  step?: number;
  suffix: string;
  value: number;
}) {
  function commit(input: HTMLInputElement) {
    const rawValue = input.value;
    const parsed = rawValue === '' ? Number.NaN : Number(rawValue);
    const next = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : value;
    const normalized = step === 1 ? Math.round(next) : Math.round(next / step) * step;
    input.value = String(normalized);
    onChange(normalized);
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          aria-label={label}
          className="pr-10 font-mono tabular-nums"
          inputMode="decimal"
          max={maximum}
          min={minimum}
          defaultValue={value}
          onBlur={(event) => commit(event.currentTarget)}
          onChange={(event) => {
            const rawValue = event.target.value;
            const parsed = Number(rawValue);
            if (rawValue && parsed >= minimum && parsed <= maximum) onChange(parsed);
          }}
          step={step}
          type="number"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-[#a0929b]">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function AddSectionDialog({
  customName,
  onAddCustom,
  onChangeName,
  onClose,
}: {
  customName: string;
  onAddCustom: () => void;
  onChangeName: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent className="rounded-3xl p-7">
        <DialogTitle>添加自定义板块</DialogTitle>
        <DialogDescription>
          内置板块始终保留在简历结构中，可直接用眼睛按钮显示或隐藏。
        </DialogDescription>
        <div className="mt-5">
          <Label htmlFor="custom-section-name">自定义板块</Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="custom-section-name"
              placeholder="例如：志愿经历"
              value={customName}
              onChange={(event) => onChangeName(event.target.value)}
            />
            <Button disabled={!customName.trim()} onClick={onAddCustom}>
              <Plus size={16} />
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VisibilityNotice({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[#e5d7dc] bg-[#f8f1f3] px-4 py-3 text-[#6f5d66]">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-[#a63a2a] shadow-sm">
        <EyeOff size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#493941]">“{label}”当前已隐藏</p>
        <p className="mt-0.5 text-xs">内容仍会保存，但不会出现在实时预览和 PDF 中。</p>
      </div>
      <Button onClick={onRestore} size="sm" type="button" variant="outline">
        <Eye size={15} />
        恢复显示
      </Button>
    </div>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: [string, string][];
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, name]) => (
            <SelectItem key={key} value={key}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ConfirmDialog({
  description,
  onCancel,
  onConfirm,
  title,
}: {
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <Dialog open>
      <DialogContent className="rounded-2xl">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            取消
          </Button>
          <Button onClick={onConfirm}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ConflictDialog({
  allowOverwrite,
  mode,
  onOverwrite,
  onReload,
}: {
  allowOverwrite: boolean;
  mode: ResumeEditorMode;
  onOverwrite: () => void;
  onReload: () => void;
}) {
  return (
    <Dialog open>
      <DialogContent className="rounded-2xl">
        <DialogTitle>检测到其他页面的更新</DialogTitle>
        <DialogDescription>
          {mode === 'local' && !allowOverwrite
            ? '浏览器中的版本已变化。当前页面会保持只读，请加载浏览器中的最新内容后再继续编辑。'
            : mode === 'local'
              ? '为了避免静默覆盖，请选择加载浏览器中的最新内容，或明确使用当前页面内容覆盖。'
              : '为了避免静默覆盖，请选择加载服务器内容，或明确使用当前页面内容覆盖。'}
        </DialogDescription>
        <DialogFooter>
          <Button onClick={onReload} variant="outline">
            {mode === 'local' ? '加载浏览器版本' : '加载服务器版本'}
          </Button>
          {allowOverwrite ? <Button onClick={onOverwrite}>保留本地版本</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function IssuesDialog({
  issues,
  mode,
  onCancel,
  onContinue,
}: {
  issues: string[];
  mode: 'complete' | 'export';
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Dialog open>
      <DialogContent className="rounded-2xl">
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="text-amber-600" size={20} />
          信息还不完整
        </DialogTitle>
        <DialogDescription>
          {mode === 'complete'
            ? '标记完成前，请先处理以下问题。'
            : '这些内容仍不完整，你可以返回修改或继续导出草稿。'}
        </DialogDescription>
        <ul className="mt-4 space-y-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {issues.map((issue) => (
            <li key={issue}>• {issue}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            返回编辑
          </Button>
          {mode === 'export' ? <Button onClick={onContinue}>仍然导出</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function EditorLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f2eeef]">
      <div className="text-center">
        <LoaderCircle className="mx-auto animate-spin text-[#bf301e]" size={30} />
        <p className="mt-3 text-sm text-[#756b72]">正在铺开你的简历工作台…</p>
      </div>
    </main>
  );
}
function EditorFailure({
  message,
  onBack,
  onClear,
  onRetry,
  returnLabel,
}: {
  message: string;
  onBack: () => void;
  onClear?: () => void;
  onRetry: () => void;
  returnLabel: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f2eeef] p-6">
      <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
        <Settings2 className="mx-auto text-[#bf301e]" size={30} />
        <h1 className="mt-4 font-serif text-2xl font-semibold">编辑器暂时打不开</h1>
        <p className="mt-2 text-sm text-[#756b72]">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={onBack} variant="outline">
            {returnLabel}
          </Button>
          {onClear ? (
            <Button onClick={onClear} variant="destructive">
              清除本地数据
            </Button>
          ) : null}
          <Button onClick={onRetry}>重试</Button>
        </div>
      </div>
    </main>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-') || '未命名简历';
}
