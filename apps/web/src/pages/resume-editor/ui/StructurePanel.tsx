/* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and transform state through its hook result. */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  Award,
  BriefcaseBusiness,
  Check,
  FileText,
  FolderKanban,
  GraduationCap,
  GripVertical,
  Eye,
  EyeOff,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';

import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

import { moveById } from '../model/resume.model';
import { profileHasContent, sectionHasContent } from '../model/resume.preview';
import type { ResumeProfile, ResumeSection } from '../model/resume.types';

const icons = {
  summary: FileText,
  work: BriefcaseBusiness,
  education: GraduationCap,
  project: FolderKanban,
  skills: Sparkles,
  awards: Award,
  custom: FileText,
};

export function StructurePanel({
  activeId,
  onAdd,
  onFormat,
  onMove,
  onRemove,
  onSelect,
  onToggleProfile,
  onToggleSection,
  profile,
  hasAvatar,
  hasSchoolLogo,
  sections,
}: {
  activeId: string;
  hasAvatar: boolean;
  hasSchoolLogo: boolean;
  onAdd: () => void;
  onFormat: () => void;
  onMove: (sections: ResumeSection[]) => void;
  onRemove: (section: ResumeSection) => void;
  onSelect: (id: string) => void;
  onToggleProfile: () => void;
  onToggleSection: (section: ResumeSection) => void;
  profile: ResumeProfile;
  sections: ResumeSection[];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function moveButton(id: string, delta: number) {
    const index = sections.findIndex((section) => section.id === id);
    const target = sections[index + delta];
    if (!target) return;
    const moved = moveById(sections, id, target.id);
    onMove(moved);
  }
  function dragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id)
      onMove(moveById(sections, String(active.id), String(over.id)));
  }
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-[#e7dfe4] bg-[#f8f5f6]">
      <div className="border-b border-[#e7dfe4] px-5 py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#a63a2a]">
          Resume map
        </p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-[#30252d]">简历结构</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <StructureProfileItem
          active={activeId === 'profile'}
          enabled={profile.enabled}
          hasContent={profileHasContent(profile, hasAvatar, hasSchoolLogo)}
          onSelect={() => onSelect('profile')}
          onToggle={onToggleProfile}
        />
        <DndContext collisionDetection={closestCenter} onDragEnd={dragEnd} sensors={sensors}>
          <SortableContext
            items={sections.map((section) => section.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              {sections.map((section, index) => (
                <StructureItem
                  active={activeId === section.id}
                  hasContent={sectionHasContent(section)}
                  index={index}
                  key={section.id}
                  onDown={() => moveButton(section.id, 1)}
                  onRemove={() => onRemove(section)}
                  onSelect={() => onSelect(section.id)}
                  onToggle={() => onToggleSection(section)}
                  onUp={() => moveButton(section.id, -1)}
                  section={section}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <Button className="mt-4 w-full border-dashed" onClick={onAdd} variant="outline">
          <Plus size={16} />
          添加板块
        </Button>
      </div>
      <div className="border-t border-[#e7dfe4] p-3">
        <Button className="h-11 w-full justify-start rounded-xl" onClick={onFormat} variant="ghost">
          <Settings2 size={17} />
          排版设置
        </Button>
      </div>
    </aside>
  );
}

function StructureProfileItem({
  active,
  enabled,
  hasContent,
  onSelect,
  onToggle,
}: {
  active: boolean;
  enabled: boolean;
  hasContent: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'mb-2 flex items-center rounded-xl border px-1 py-1 transition-colors',
        active
          ? 'border-[#e6d7e3] bg-white text-[#bf301e] shadow-sm'
          : 'border-transparent text-[#655a62] hover:bg-white/70',
        !enabled && 'bg-[#f0ebed] text-[#91858d]',
      )}
    >
      <Button
        className="h-11 min-w-0 flex-1 justify-start gap-2 px-3 hover:bg-transparent"
        onClick={onSelect}
        variant="ghost"
      >
        <UserRound className="shrink-0" size={17} />
        <span className="min-w-0 text-left">
          <span className="block truncate">基本信息</span>
          {!enabled || !hasContent ? (
            <span className="block truncate text-[10px] font-normal text-[#9a8d95]">
              {!enabled ? '不会输出' : '暂无可预览内容'}
            </span>
          ) : null}
        </span>
        {active ? <Check className="ml-auto shrink-0" size={14} /> : null}
      </Button>
      <VisibilityButton enabled={enabled} label="基本信息" onToggle={onToggle} />
    </div>
  );
}

function StructureItem({
  active,
  hasContent,
  index,
  onDown,
  onRemove,
  onSelect,
  onToggle,
  onUp,
  section,
}: {
  active: boolean;
  hasContent: boolean;
  index: number;
  onDown: () => void;
  onRemove: () => void;
  onSelect: () => void;
  onToggle: () => void;
  onUp: () => void;
  section: ResumeSection;
}) {
  const sortable = useSortable({ id: section.id });
  const Icon = icons[section.type];
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        'group flex items-center rounded-xl border border-transparent px-1 py-1 transition',
        active
          ? 'border-[#e6d7e3] bg-white text-[#bf301e] shadow-sm'
          : 'text-[#655a62] hover:bg-white/70',
        !section.enabled && 'bg-[#f0ebed] text-[#91858d]',
      )}
    >
      <Button
        aria-label={`拖拽 ${section.title}`}
        className="size-8 shrink-0 cursor-grab"
        size="icon"
        variant="ghost"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical size={15} />
      </Button>
      <Button
        className="h-9 min-w-0 flex-1 justify-start gap-2 px-1 hover:bg-transparent"
        onClick={onSelect}
        variant="ghost"
      >
        <Icon className="shrink-0" size={16} />
        <span className="min-w-0 text-left">
          <span className="block truncate">{section.title}</span>
          {!section.enabled || !hasContent ? (
            <span className="block truncate text-[10px] font-normal text-[#9a8d95]">
              {!section.enabled ? '不会输出' : '暂无可预览内容'}
            </span>
          ) : null}
        </span>
        {active ? <Check className="ml-auto shrink-0" size={14} /> : null}
      </Button>
      <VisibilityButton enabled={section.enabled} label={section.title} onToggle={onToggle} />
      <div className="hidden shrink-0 group-hover:flex group-focus-within:flex">
        <Button
          aria-label="上移板块"
          disabled={index === 0}
          onClick={onUp}
          size="icon"
          variant="ghost"
        >
          <ArrowUp size={13} />
        </Button>
        <Button aria-label="下移板块" onClick={onDown} size="icon" variant="ghost">
          <ArrowDown size={13} />
        </Button>
        {section.type === 'custom' ? (
          <Button
            aria-label={`永久删除 ${section.title}`}
            onClick={onRemove}
            size="icon"
            variant="ghost"
          >
            <Trash2 size={13} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function VisibilityButton({
  enabled,
  label,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  const Icon = enabled ? Eye : EyeOff;
  return (
    <Button
      aria-label={`${enabled ? '隐藏' : '显示'} ${label}`}
      className={cn(
        'size-9 shrink-0 rounded-lg',
        enabled ? 'text-[#766871]' : 'bg-white/70 text-[#a63a2a]',
      )}
      onClick={onToggle}
      size="icon"
      variant="ghost"
    >
      <Icon size={15} />
    </Button>
  );
}
