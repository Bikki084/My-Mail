"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

function formatBytes(n: number): string {
  if (n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  streamUrl: string;
  downloadUrl: string;
  filename: string;
  contentType: string;
  initialSizeBytes: number;
};

export function ActivityAttachmentPreview({
  streamUrl,
  downloadUrl,
  filename,
  contentType,
  initialSizeBytes,
}: Props) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = React.useState(initialSizeBytes);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setBlobUrl(null);
      try {
        const res = await fetch(streamUrl, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Could not load attachment (${res.status}).`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        if (blob.size === 0) {
          throw new Error("Attachment file is empty.");
        }
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setSizeBytes(blob.size);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load attachment.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [streamUrl]);

  const isPdf = contentType === "application/pdf";
  const isImage = contentType.startsWith("image/");

  return (
    <li className="rounded border border-gray-800 bg-[#0F172A] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-gray-200">{filename}</span>
        <div className="flex items-center gap-3">
          <span className="text-gray-500">{loading ? "…" : formatBytes(sizeBytes)}</span>
          <a
            href={downloadUrl}
            download={filename}
            className="text-indigo-400 hover:text-indigo-300"
          >
            Download
          </a>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center gap-2 rounded border border-gray-700 bg-white text-sm text-gray-500">
          <Loader2 className="size-4 animate-spin" />
          Loading preview…
        </div>
      ) : error ? (
        <div className="rounded border border-gray-700 bg-white p-4 text-sm text-gray-600">
          {error}{" "}
          <a href={downloadUrl} className="text-indigo-600 hover:text-indigo-500">
            Download instead
          </a>
        </div>
      ) : blobUrl && isPdf ? (
        <iframe
          title={`Preview: ${filename}`}
          src={blobUrl}
          className="h-80 w-full rounded border border-gray-700 bg-white"
        />
      ) : blobUrl && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={blobUrl}
          alt={filename}
          className="max-h-80 w-full rounded border border-gray-700 object-contain bg-white"
        />
      ) : null}
    </li>
  );
}
