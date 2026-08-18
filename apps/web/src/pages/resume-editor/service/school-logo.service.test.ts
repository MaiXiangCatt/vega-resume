import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHOOL_LOGO_SPEC } from '../model/resume.presentation';
import { cropSchoolLogo } from './school-logo.service';

describe('cropSchoolLogo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a 500x500 transparent PNG without painting a background', async () => {
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const context = { clearRect, drawImage, fillRect } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      expect(type).toBe('image/png');
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    class LoadedImage {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', LoadedImage);

    const blob = await cropSchoolLogo('blob:source', {
      height: 320,
      width: 320,
      x: 10,
      y: 20,
    });

    expect(blob.type).toBe('image/png');
    expect(clearRect).toHaveBeenCalledWith(
      0,
      0,
      SCHOOL_LOGO_SPEC.outputWidthPx,
      SCHOOL_LOGO_SPEC.outputHeightPx,
    );
    expect(drawImage).toHaveBeenCalled();
    expect(fillRect).not.toHaveBeenCalled();
  });
});
