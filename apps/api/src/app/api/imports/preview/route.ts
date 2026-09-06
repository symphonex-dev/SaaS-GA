import {
  CSV_DELIMITERS,
  ERROR_CODES,
  csvColumnMappingSchema,
  dateOrderSchema,
  type CsvDelimiter,
} from '@subscription-manager/shared';

import { AppError } from '@/lib/api/errors';
import { enforceRateLimit, route } from '@/lib/api/handler';
import { clientIpFromRequest } from '@/lib/api/request';
import { jsonSuccess } from '@/lib/api/response';
import type { UploadedFile } from '@/lib/import/file-guard';
import { requireUser } from '@/server/auth/session';
import { importService, type PreviewOptions } from '@/server/services/import.service';

/**
 * POST /api/imports/preview — `specs/import-releves.md` §10.
 *
 * Reçoit le fichier en `multipart/form-data` (champ `file`), l'analyse et
 * renvoie l'aperçu. Aucune dépense n'est créée à cette étape : l'insertion
 * n'a lieu qu'après confirmation explicite (§13).
 *
 * Champs optionnels, utilisés quand le serveur a refusé de deviner :
 *  - `delimiter` : séparateur confirmé après une détection ambiguë (§4.2) ;
 *  - `mapping`   : mapping JSON des colonnes (§4.4) ;
 *  - `dateOrder` : ordre des dates numériques (§4.6).
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);

  // Rate limiting dédié à l'upload (§11) : par utilisateur et par IP.
  await enforceRateLimit('import:upload', user.id);
  await enforceRateLimit('import:upload', clientIpFromRequest(request));

  const form = await readFormData(request);
  const file = await fileFromForm(form);
  const options = optionsFromForm(form);

  const preview = await importService.preview(user, file, options);

  return jsonSuccess(preview, { status: 201 });
});

async function readFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new AppError(
      ERROR_CODES.IMPORT_FILE_INVALID,
      'Requête multipart/form-data invalide.',
      'file',
    );
  }
}

async function fileFromForm(form: FormData): Promise<UploadedFile> {
  const entry = form.get('file');

  if (entry === null || typeof entry === 'string') {
    throw new AppError(ERROR_CODES.IMPORT_FILE_INVALID, 'Champ « file » absent.', 'file');
  }

  const blob = entry as Blob & { name?: string; type?: string };

  return {
    // Le nom d'origine est purement informatif : il n'est jamais utilisé pour
    // construire un chemin sur le disque (voir `withTemporaryFile`).
    filename: typeof blob.name === 'string' && blob.name.length > 0 ? blob.name : null,
    mimeType: typeof blob.type === 'string' ? blob.type : '',
    content: Buffer.from(await blob.arrayBuffer()),
  };
}

function optionsFromForm(form: FormData): PreviewOptions {
  const options: PreviewOptions = {};

  const delimiter = form.get('delimiter');

  if (typeof delimiter === 'string' && delimiter.length > 0) {
    const normalized = delimiter === '\\t' ? '\t' : delimiter;

    if (!(CSV_DELIMITERS as readonly string[]).includes(normalized)) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Séparateur non supporté.', 'delimiter');
    }

    options.delimiter = normalized as CsvDelimiter;
  }

  const mapping = form.get('mapping');

  if (typeof mapping === 'string' && mapping.length > 0) {
    let raw: unknown;

    try {
      raw = JSON.parse(mapping);
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Mapping JSON invalide.', 'mapping');
    }

    options.mapping = csvColumnMappingSchema.parse(raw);
  }

  const dateOrder = form.get('dateOrder');

  if (typeof dateOrder === 'string' && dateOrder.length > 0) {
    options.dateOrder = dateOrderSchema.parse(dateOrder);
  }

  return options;
}
