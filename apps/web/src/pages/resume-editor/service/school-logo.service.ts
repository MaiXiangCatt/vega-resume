import { SCHOOL_LOGO_SPEC } from '../model/resume.presentation';

const MAX_SCHOOL_LOGO_BYTES = 512 * 1024;

type CropArea = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export async function cropSchoolLogo(source: string, area: CropArea) {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = SCHOOL_LOGO_SPEC.outputWidthPx;
  canvas.height = SCHOOL_LOGO_SPEC.outputHeightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('校徽处理失败'))),
      'image/png',
    ),
  );
  if (blob.size > MAX_SCHOOL_LOGO_BYTES) {
    throw new Error('裁剪后的校徽超过 512 KiB，请换用更简洁的图片');
  }
  return blob;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片'));
    image.src = source;
  });
}
