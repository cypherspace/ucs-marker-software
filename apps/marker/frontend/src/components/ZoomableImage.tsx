import { useRef } from 'react';
import { useElementWidth } from '../hooks/useElementWidth';
import { useCtrlWheelZoom, useZoom } from '../hooks/useZoom';
import { ZoomControls } from './ZoomControls';

/** An image that fits the width of its box, with zoom buttons and Ctrl + wheel, scrolling to pan. */
export function ZoomableImage({ src, alt, storageKey }: { src: string; alt: string; storageKey: string }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(paneRef);
  const { zoom, setZoom, zoomIn, zoomOut, fit } = useZoom(storageKey);
  useCtrlWheelZoom(paneRef, zoom, setZoom);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 justify-end border-b border-slate-200 bg-white px-2 py-1">
        <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} label="Mark scheme zoom" />
      </div>
      <div ref={paneRef} className="min-h-0 flex-1 overflow-auto bg-white">
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ width: width > 0 ? Math.max(60, (width - 4) * zoom) : undefined, maxWidth: 'none' }}
          className="block"
        />
      </div>
    </div>
  );
}
