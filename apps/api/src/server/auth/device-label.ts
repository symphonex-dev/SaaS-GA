import { deviceLabelSchema } from '@subscription-manager/shared';

/**
 * Libellé d'appareil facultatif, transmis par le client mobile via l'en-tête
 * `X-Device-Label` (ex. « Android — Pixel 8 »).
 *
 * Informatif uniquement : il est affiché dans la liste des sessions et n'est
 * jamais utilisé comme critère d'autorisation
 * (`specs/schema-donnees.md` §10).
 */
export function deviceLabelFromRequest(request: Request): string | null {
  const raw = request.headers.get('x-device-label');

  if (raw === null) {
    return null;
  }

  // Un en-tête HTTP ne peut transporter que des caractères ASCII : le client
  // envoie donc un libellé encodé en pourcent (« Android%20%E2%80%94%20Pixel%208 »).
  let decoded = raw;

  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // En-tête mal encodé : on retombe sur la valeur brute, qui sera validée.
  }

  const parsed = deviceLabelSchema.safeParse(decoded);

  return parsed.success ? parsed.data : null;
}
