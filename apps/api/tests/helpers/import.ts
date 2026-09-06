import type { ImportPreviewDto } from '@subscription-manager/shared';

import { POST as previewRoute } from '@/app/api/imports/preview/route';

import { expectSuccess } from './http';

/**
 * Helpers d'import pour les tests : construction de requêtes multipart et
 * lecture des aperçus.
 */
export interface UploadOptions {
  filename?: string;
  mimeType?: string;
  delimiter?: string;
  mapping?: unknown;
  dateOrder?: string;
  headers?: Record<string, string>;
}

export function uploadRequest(content: Buffer | string, options: UploadOptions = {}): Request {
  const form = new FormData();
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: options.mimeType ?? 'text/csv' }),
    options.filename ?? 'releve.csv',
  );

  if (options.delimiter !== undefined) {
    form.append('delimiter', options.delimiter);
  }

  if (options.mapping !== undefined) {
    form.append('mapping', JSON.stringify(options.mapping));
  }

  if (options.dateOrder !== undefined) {
    form.append('dateOrder', options.dateOrder);
  }

  const headers = new Headers(options.headers ?? {});

  return new Request('https://api.test/api/imports/preview', {
    method: 'POST',
    headers,
    body: form,
  });
}

export function authenticatedUpload(
  token: string,
  content: Buffer | string,
  options: UploadOptions = {},
): Request {
  return uploadRequest(content, {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${token}` },
  });
}

export async function previewImport(
  token: string,
  content: Buffer | string,
  options: UploadOptions = {},
): Promise<ImportPreviewDto> {
  const response = await previewRoute(authenticatedUpload(token, content, options));

  return expectSuccess<ImportPreviewDto>(response);
}

/** Relevé CSV français minimal, utilisé par plusieurs scénarios. */
export const CSV_RELEVE = [
  'Date;Libellé;Montant',
  '05/01/2026;NETFLIX.COM AMSTERDAM;-13,49',
  '07/01/2026;SPOTIFY AB STOCKHOLM;-11,99',
  '12/01/2026;VIREMENT SALAIRE;2450,00',
].join('\n');
