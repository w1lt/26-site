"use client";

import { useEffect, useRef } from "react";
import { encode } from "uqr";

const TARGET = "https://willwhitehead.com";
const SHORT_AXIS_CELLS = 3;
const MAX_CELLS = 12;
const ECC = ["L", "M", "Q", "H"] as const;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export default function QrCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const moduleCanvas = document.createElement("canvas");
    const moduleCtx = moduleCanvas.getContext("2d", { alpha: false });
    if (!moduleCtx) return;

    let raf = 0;
    let running = true;
    let frameId = 0;
    const entropy = new Uint8Array(96);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };

    const randomUrl = (cell: number) => {
      crypto.getRandomValues(entropy);
      const extra = 24 + (entropy[0] % 48);
      let token = `${frameId.toString(36)}-${cell.toString(36)}-`;
      for (let i = 0; i < extra; i++) {
        token += ALPHABET[entropy[i + 1] % ALPHABET.length];
      }
      return `${TARGET}?${token}`;
    };

    const paintQr = (data: boolean[][], size: number) => {
      if (moduleCanvas.width !== size || moduleCanvas.height !== size) {
        moduleCanvas.width = size;
        moduleCanvas.height = size;
      }
      const image = moduleCtx.createImageData(size, size);
      const pixels = image.data;

      for (let y = 0; y < size; y++) {
        const row = data[y];
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const on = row[x] ? 255 : 0;
          pixels[i] = on;
          pixels[i + 1] = on;
          pixels[i + 2] = on;
          pixels[i + 3] = 255;
        }
      }

      moduleCtx.putImageData(image, 0, 0);
    };

    const frame = () => {
      if (!running) return;
      frameId += 1;

      const { width, height } = canvas;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;

      const short = Math.min(width, height);
      let cell = Math.max(1, Math.floor(short / SHORT_AXIS_CELLS));
      let cols = Math.max(1, Math.floor(width / cell));
      let rows = Math.max(1, Math.floor(height / cell));
      while (cols * rows > MAX_CELLS && (cols > 1 || rows > 1)) {
        cell += 1;
        cols = Math.max(1, Math.floor(width / cell));
        rows = Math.max(1, Math.floor(height / cell));
      }
      cell = Math.floor(Math.min(width / cols, height / rows));
      const originX = Math.floor((width - cols * cell) / 2);
      const originY = Math.floor((height - rows * cell) / 2);

      let index = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const url = randomUrl(index++);
          const { data, size } = encode(url, {
            ecc: ECC[entropy[90] % ECC.length],
            maskPattern: entropy[91] % 8,
            minVersion: 2 + (entropy[92] % 6),
            border: 2,
          });
          paintQr(data, size);
          ctx.drawImage(
            moduleCanvas,
            originX + col * cell,
            originY + row * cell,
            cell,
            cell
          );
        }
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 block h-full w-full bg-black"
      aria-label="QR codes linking to willwhitehead.com"
    />
  );
}
