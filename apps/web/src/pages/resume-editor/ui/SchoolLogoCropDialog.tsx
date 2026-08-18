import Cropper, { type Area } from 'react-easy-crop';
import { Minus, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/shared/ui/dialog';

import { cropSchoolLogo } from '../service/school-logo.service';

export function SchoolLogoCropDialog({
  image,
  onClose,
  onSave,
}: {
  image: string;
  onClose: () => void;
  onSave: (blob: Blob) => Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const complete = useCallback((_percent: Area, pixels: Area) => setArea(pixels), []);

  async function save() {
    if (!area) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await cropSchoolLogo(image, area));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '校徽上传失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      open
    >
      <DialogContent className="max-w-xl rounded-3xl p-6">
        <DialogTitle>裁剪校徽</DialogTitle>
        <DialogDescription>
          拖动图片并调整缩放，校徽会以 1:1 方形 PNG 保存，透明背景会保留。
        </DialogDescription>
        <div className="relative mt-3 h-96 overflow-hidden rounded-2xl bg-[linear-gradient(45deg,#ede8eb_25%,transparent_25%),linear-gradient(-45deg,#ede8eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ede8eb_75%),linear-gradient(-45deg,transparent_75%,#ede8eb_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]">
          <Cropper
            aspect={1}
            crop={crop}
            cropShape="rect"
            image={image}
            onCropChange={setCrop}
            onCropComplete={complete}
            onZoomChange={setZoom}
            showGrid={false}
            zoom={zoom}
          />
        </div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            aria-label="缩小校徽"
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.15))}
            size="icon"
            variant="outline"
          >
            <Minus size={16} />
          </Button>
          <span className="w-20 text-center text-sm text-[#746873]">{Math.round(zoom * 100)}%</span>
          <Button
            aria-label="放大校徽"
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.15))}
            size="icon"
            variant="outline"
          >
            <Plus size={16} />
          </Button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button disabled={saving} onClick={onClose} variant="outline">
            取消
          </Button>
          <Button disabled={!area || saving} onClick={() => void save()}>
            {saving ? '正在上传…' : '确认校徽'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
