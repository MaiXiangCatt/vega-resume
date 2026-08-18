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
  Check,
  GripVertical,
  ImagePlus,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

import { createSectionItem, moveById } from '../model/resume.model';
import type { ResumeProfile, ResumeSection } from '../model/resume.types';
import { MarkdownEditor } from './MarkdownEditor';
import { MonthPicker } from './MonthPicker';

export function ProfileEditor({
  avatar,
  onAvatar,
  onChange,
  onDeleteAvatar,
  onDeleteSchoolLogo,
  onSchoolLogo,
  profile,
  schoolLogo,
}: {
  avatar: string | null;
  onAvatar: () => void;
  onChange: (profile: ResumeProfile) => void;
  onDeleteAvatar: () => void;
  onDeleteSchoolLogo: () => void;
  onSchoolLogo: () => void;
  profile: ResumeProfile;
  schoolLogo: string | null;
}) {
  const setField = (key: Exclude<keyof ResumeProfile, 'enabled' | 'links'>, value: string) =>
    onChange({ ...profile, [key]: value });
  return (
    <EditorPanel
      eyebrow="Identity"
      title="基本信息"
      description="这部分固定在简历头部，不参与板块排序。"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex items-center gap-4 rounded-2xl border border-[#e8e0e6] bg-[#fbf9fa] p-4">
          <div className="grid h-28 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#ded4db] bg-white text-[#8f7d8b]">
            {avatar ? (
              <img alt="简历头像" className="size-full object-contain" src={avatar} />
            ) : (
              <ImagePlus aria-hidden="true" size={24} />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[#32272f]">简历头像</p>
            <p className="mt-1 text-xs leading-5 text-[#81757e]">5:7 裁剪，每份简历独立保存。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={onAvatar} size="sm" variant="outline">
                {avatar ? '替换头像' : '上传头像'}
              </Button>
              {avatar ? (
                <Button onClick={onDeleteAvatar} size="sm" variant="ghost">
                  删除头像
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-[#e8e0e6] bg-[#fbf9fa] p-4">
          <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#ded4db] bg-white text-[#8f7d8b]">
            {schoolLogo ? (
              <img alt="学校校徽" className="size-full object-contain" src={schoolLogo} />
            ) : (
              <ImagePlus aria-hidden="true" size={24} />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[#32272f]">学校校徽</p>
            <p className="mt-1 text-xs leading-5 text-[#81757e]">
              1:1 裁剪，透明 PNG，位于头像对侧。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={onSchoolLogo} size="sm" variant="outline">
                {schoolLogo ? '替换校徽' : '上传校徽'}
              </Button>
              {schoolLogo ? (
                <Button onClick={onDeleteSchoolLogo} size="sm" variant="ghost">
                  删除校徽
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="姓名">
          <Input
            aria-label="姓名"
            value={profile.fullName}
            onChange={(event) => setField('fullName', event.target.value)}
          />
        </Field>
        <Field label="目标岗位">
          <Input
            aria-label="目标岗位"
            value={profile.targetRole}
            onChange={(event) => setField('targetRole', event.target.value)}
          />
        </Field>
        <Field label="手机号">
          <Input
            aria-label="手机号"
            value={profile.phone}
            onChange={(event) => setField('phone', event.target.value)}
          />
        </Field>
        <Field label="邮箱">
          <Input
            aria-label="邮箱"
            type="email"
            value={profile.email}
            onChange={(event) => setField('email', event.target.value)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="所在城市">
            <Input
              aria-label="所在城市"
              value={profile.location}
              onChange={(event) => setField('location', event.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="border-t border-[#eee8ec] pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">联系链接</h3>
            <p className="mt-1 text-xs text-[#81757e]">作品集、GitHub、LinkedIn 或个人网站。</p>
          </div>
          <Button
            onClick={() =>
              onChange({
                ...profile,
                links: [...profile.links, { id: crypto.randomUUID(), label: '', url: '' }],
              })
            }
            size="sm"
            variant="outline"
          >
            <Plus size={15} />
            添加链接
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {profile.links.map((link) => (
            <div className="grid grid-cols-[0.8fr_1.5fr_auto] gap-2" key={link.id}>
              <Input
                aria-label="链接名称"
                placeholder="名称"
                value={link.label}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    links: profile.links.map((item) =>
                      item.id === link.id ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              <Input
                aria-label="链接地址"
                placeholder="https://"
                value={link.url}
                onChange={(event) =>
                  onChange({
                    ...profile,
                    links: profile.links.map((item) =>
                      item.id === link.id ? { ...item, url: event.target.value } : item,
                    ),
                  })
                }
              />
              <Button
                aria-label="删除链接"
                onClick={() =>
                  onChange({
                    ...profile,
                    links: profile.links.filter((item) => item.id !== link.id),
                  })
                }
                size="icon"
                variant="ghost"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </EditorPanel>
  );
}

export function SectionEditor({
  defaultEntryGapPx,
  defaultSectionGapPx,
  onChange,
  section,
}: {
  defaultEntryGapPx: number;
  defaultSectionGapPx: number;
  onChange: (section: ResumeSection) => void;
  section: ResumeSection;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (section.type === 'summary') {
    return (
      <EditorPanel
        eyebrow="Narrative"
        title={section.title}
        description="使用 Markdown 组织简介内容，右侧会实时显示最终效果。"
      >
        <Field label="板块标题">
          <Input
            aria-label="板块标题"
            value={section.title}
            onChange={(event) => onChange({ ...section, title: event.target.value })}
          />
        </Field>
        <OptionalSpacingField
          defaultValue={defaultSectionGapPx}
          label="模块上方间距"
          onChange={(spacingBeforePx) => onChange({ ...section, spacingBeforePx })}
          value={section.spacingBeforePx}
        />
        <Field label="简介内容">
          <MarkdownEditor
            ariaLabel="简介内容"
            className="min-h-56"
            placeholder="概括你的经验、优势和求职方向"
            value={section.text}
            onChange={(text) => onChange({ ...section, text })}
          />
        </Field>
      </EditorPanel>
    );
  }
  if (section.type === 'skills') {
    return (
      <EditorPanel
        eyebrow="Expertise"
        title={section.title}
        description="使用 Markdown 自由组织技能、工具和熟练程度，右侧会实时显示最终效果。"
      >
        <Field label="板块标题">
          <Input
            aria-label="板块标题"
            value={section.title}
            onChange={(event) => onChange({ ...section, title: event.target.value })}
          />
        </Field>
        <OptionalSpacingField
          defaultValue={defaultSectionGapPx}
          label="模块上方间距"
          onChange={(spacingBeforePx) => onChange({ ...section, spacingBeforePx })}
          value={section.spacingBeforePx}
        />
        <Field label="技能内容">
          <MarkdownEditor
            ariaLabel="技能内容"
            className="min-h-56"
            placeholder={'- TypeScript：熟练\n- React：熟悉组件设计与性能优化'}
            value={section.description}
            onChange={(description) => onChange({ ...section, description })}
          />
        </Field>
      </EditorPanel>
    );
  }
  const items = section.items as Array<{ id: string } & Record<string, unknown>>;
  const setItems = (nextItems: Array<{ id: string } & Record<string, unknown>>) =>
    onChange({ ...section, items: nextItems } as ResumeSection);
  const updateItem = (id: string, key: string, value: string | boolean | number | undefined) =>
    setItems(items.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  const removeItem = (id: string) => setItems(items.filter((item) => item.id !== id));
  const moveItem = (id: string, delta: number) => {
    const index = items.findIndex((item) => item.id === id);
    const target = items[index + delta];
    if (target) setItems(moveById(items, id, target.id));
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      setItems(moveById(items, String(active.id), String(over.id)));
  };
  return (
    <EditorPanel
      eyebrow="Section"
      title={section.title}
      description="记录可以独立排序，空记录不会进入预览。"
    >
      <Field label="板块标题">
        <Input
          aria-label="板块标题"
          value={section.title}
          onChange={(event) => onChange({ ...section, title: event.target.value })}
        />
      </Field>
      <OptionalSpacingField
        defaultValue={defaultSectionGapPx}
        label="模块上方间距"
        onChange={(spacingBeforePx) => onChange({ ...section, spacingBeforePx })}
        value={section.spacingBeforePx}
      />
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-4">
            {items.map((item, index) => (
              <SortableItemCard
                index={index}
                itemId={item.id}
                key={item.id}
                onDown={() => moveItem(item.id, 1)}
                onRemove={() => removeItem(item.id)}
                onUp={() => moveItem(item.id, -1)}
                spacingControl={
                  index > 0 ? (
                    <OptionalSpacingField
                      defaultValue={defaultEntryGapPx}
                      label="与上一条记录间距"
                      onChange={(spacingBeforePx) =>
                        updateItem(item.id, 'spacingBeforePx', spacingBeforePx)
                      }
                      value={
                        typeof item.spacingBeforePx === 'number' ? item.spacingBeforePx : undefined
                      }
                    />
                  ) : null
                }
              >
                {renderItemFields(
                  section.type,
                  item as unknown as Record<string, string | boolean | number | undefined>,
                  updateItem,
                )}
              </SortableItemCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        className="w-full border-dashed"
        onClick={() => setItems([...items, createSectionItem(section.type)])}
        variant="outline"
      >
        <Plus size={16} />
        新增一条{section.title}
      </Button>
    </EditorPanel>
  );
}

function renderItemFields(
  type: Exclude<ResumeSection['type'], 'summary' | 'skills'>,
  item: Record<string, string | boolean | number | undefined>,
  update: (id: string, key: string, value: string | boolean | number | undefined) => void,
) {
  const id = String(item.id);
  const input = (key: string, label: string, placeholder = '') => (
    <Field label={label}>
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={String(item[key] ?? '')}
        onChange={(event) => update(id, key, event.target.value)}
      />
    </Field>
  );
  const month = (key: string, label: string) => (
    <Field label={label}>
      <MonthPicker
        ariaLabel={label}
        onValueChange={(value) => update(id, key, value)}
        value={String(item[key] ?? '')}
      />
    </Field>
  );
  const description = () => (
    <div className="col-span-2">
      <Field label="描述">
        <MarkdownEditor
          ariaLabel="描述"
          placeholder="使用 Markdown 输入工作内容或成果"
          value={String(item.description ?? '')}
          onChange={(value) => update(id, 'description', value)}
        />
      </Field>
    </div>
  );
  if (type === 'awards')
    return (
      <div className="grid grid-cols-2 gap-4">
        {input('title', '奖项名称')}
        {input('issuer', '颁发方')}
        {month('date', '获得时间')}
        {description()}
      </div>
    );
  if (type === 'education')
    return (
      <div className="grid grid-cols-2 gap-4">
        {input('school', '学校')}
        {input('major', '专业')}
        {input('degree', '学历')}
        {month('startDate', '开始时间')}
        {month('endDate', '结束时间')}
        {description()}
      </div>
    );
  const fields = entryFieldNames(type);
  return (
    <div className="grid grid-cols-2 gap-4">
      {input(fields.titleKey, fields.titleLabel)}
      {input(fields.subtitleKey, fields.subtitleLabel)}
      {fields.hasLocation ? input('location', '地点') : null}
      {month('startDate', '开始时间')}
      {!item.isCurrent ? month('endDate', '结束时间') : <div />}
      <div className="col-span-2">
        <Button
          aria-pressed={Boolean(item.isCurrent)}
          className="gap-2"
          onClick={() => update(id, 'isCurrent', !item.isCurrent)}
          size="sm"
          variant={item.isCurrent ? 'default' : 'outline'}
        >
          {item.isCurrent ? <Check size={14} /> : null}至今
        </Button>
      </div>
      {description()}
    </div>
  );
}

function entryFieldNames(type: 'work' | 'project' | 'custom') {
  switch (type) {
    case 'work':
      return {
        hasLocation: true,
        subtitleKey: 'role',
        subtitleLabel: '角色/职位',
        titleKey: 'company',
        titleLabel: '公司',
      };
    case 'project':
      return {
        hasLocation: false,
        subtitleKey: 'role',
        subtitleLabel: '角色/职位',
        titleKey: 'name',
        titleLabel: '项目名称',
      };
    case 'custom':
      return {
        hasLocation: true,
        subtitleKey: 'subtitle',
        subtitleLabel: '副标题',
        titleKey: 'title',
        titleLabel: '标题',
      };
  }
}

function SortableItemCard({
  children,
  index,
  itemId,
  onDown,
  onRemove,
  onUp,
  spacingControl,
}: {
  children: ReactNode;
  index: number;
  itemId: string;
  onDown: () => void;
  onRemove: () => void;
  onUp: () => void;
  spacingControl: ReactNode;
}) {
  const sortable = useSortable({ id: itemId });
  return (
    <Card
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className="rounded-2xl border-[#e7dfe4] p-4 shadow-none"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            aria-label={`拖拽第 ${index + 1} 条`}
            size="icon"
            variant="ghost"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={17} />
          </Button>
          <span className="text-sm font-semibold text-[#564952]">记录 {index + 1}</span>
        </div>
        <div className="flex gap-1">
          <Button aria-label="上移" onClick={onUp} size="icon" variant="ghost">
            <ArrowUp size={15} />
          </Button>
          <Button aria-label="下移" onClick={onDown} size="icon" variant="ghost">
            <ArrowDown size={15} />
          </Button>
          <Button aria-label="删除记录" onClick={onRemove} size="icon" variant="ghost">
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      {spacingControl ? (
        <div className="mb-4 rounded-xl border border-dashed border-[#ded4da] bg-[#fbf9fa] p-3">
          {spacingControl}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

function EditorPanel({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#a63a2a]">{eyebrow}</p>
      <h2 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.035em] text-[#251d23]">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#7d727a]">{description}</p>
      <div className="mt-7 space-y-5">{children}</div>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function OptionalSpacingField({
  defaultValue,
  label,
  onChange,
  value,
}: {
  defaultValue: number;
  label: string;
  onChange: (value: number | undefined) => void;
  value?: number;
}) {
  function commit(input: HTMLInputElement) {
    if (input.value === '') {
      onChange(undefined);
      return;
    }
    const parsed = Number(input.value);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 64) {
      onChange(parsed);
      input.value = String(parsed);
      return;
    }
    input.value = value == null ? '' : String(value);
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            aria-label={label}
            className="pr-10 font-mono tabular-nums"
            defaultValue={value}
            inputMode="numeric"
            key={value ?? 'default'}
            max={64}
            min={0}
            onBlur={(event) => commit(event.currentTarget)}
            onChange={(event) => {
              if (event.target.value === '') onChange(undefined);
            }}
            placeholder={`默认 ${defaultValue}`}
            step={1}
            type="number"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-[#a0929b]">
            px
          </span>
        </div>
        <Button
          aria-label={`恢复${label}默认值`}
          disabled={value == null}
          onClick={() => onChange(undefined)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RotateCcw size={15} />
        </Button>
      </div>
      <p className="text-xs text-[#948790]">留空时继承全局默认值 {defaultValue}px。</p>
    </div>
  );
}
