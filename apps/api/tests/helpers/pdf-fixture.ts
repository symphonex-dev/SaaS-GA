/**
 * Génère un PDF minimal (texte simple, une page) sans dépendance externe.
 *
 * Les tests d'import PDF ont besoin de fichiers réels : un PDF construit ici
 * est déterministe, versionnable en tant que code, et évite d'embarquer des
 * binaires de fixture dans le dépôt.
 */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildPdf(lines: readonly string[], pageCount = 1): Buffer {
  const contentFor = (pageLines: readonly string[]): string =>
    pageLines
      .map(
        (line, index) =>
          `BT /F1 11 Tf 40 ${String(760 - index * 18)} Td (${escapePdfText(line)}) Tj ET`,
      )
      .join('\n');

  const pageIds: number[] = [];
  const objects: string[] = [];

  // 1 = catalogue, 2 = arbre des pages, puis pour chaque page : page + contenu.
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('PAGES_PLACEHOLDER');

  const fontId = 3 + pageCount * 2;

  for (let page = 0; page < pageCount; page += 1) {
    const pageObjectId = 3 + page * 2;
    const contentObjectId = pageObjectId + 1;
    pageIds.push(pageObjectId);

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
        `/Resources << /Font << /F1 ${String(fontId)} 0 R >> >> ` +
        `/Contents ${String(contentObjectId)} 0 R >>`,
    );

    const content = contentFor(page === 0 ? lines : [`Page ${String(page + 1)}`]);
    objects.push(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
  }

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects[1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${String(id)} 0 R`)
    .join(' ')}] /Count ${String(pageCount)} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(
    xrefOffset,
  )}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
