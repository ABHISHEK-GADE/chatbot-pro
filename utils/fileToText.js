import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { parse as csvParse } from 'csv-parse';
import xlsx from 'xlsx';
import mime from 'mime-types';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'; // ✅ Node-friendly build

export async function toText(filepath, originalName = '') {
  const ext = (path.extname(originalName || filepath) || '').toLowerCase();
  const type = mime.lookup(originalName || filepath) || '';

  // ---- PDF via pdfjs-dist ----
  if (ext === '.pdf' || type === 'application/pdf') {
    const data = new Uint8Array(fs.readFileSync(filepath));
    const doc = await pdfjsLib
      .getDocument({
        data,
        // Node execution: no worker, no eval
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
        verbosity: pdfjsLib.VerbosityLevel.ERRORS
      })
      .promise;

    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ');
      out += pageText + '\n';
    }
    return out.trim();
  }

  // ---- DOCX ----
  if (ext === '.docx' || type.includes('officedocument.wordprocessingml.document')) {
    const buff = fs.readFileSync(filepath);
    const r = await mammoth.extractRawText({ buffer: buff });
    return (r.value || '').trim();
  }

  // ---- TXT ----
  if (ext === '.txt' || type.startsWith('text/')) {
    return fs.readFileSync(filepath, 'utf8');
  }

  // ---- CSV ----
  if (ext === '.csv' || type.includes('csv')) {
    const csv = fs.readFileSync(filepath, 'utf8');
    const rows = await new Promise((resolve, reject) => {
      csvParse(csv, {}, (err, out) => (err ? reject(err) : resolve(out)));
    });
    return rows.map((r) => r.join(', ')).join('\n');
  }

  // ---- XLSX ----
  if (ext === '.xlsx' || type.includes('spreadsheetml.sheet')) {
    const wb = xlsx.read(fs.readFileSync(filepath));
    let out = '';
    wb.SheetNames.forEach((name) => {
      const sheet = wb.Sheets[name];
      const rows = xlsx.utils.sheet_to_csv(sheet);
      out += `--- Sheet: ${name} ---\n${rows}\n`;
    });
    return out.trim();
  }

  // ---- Fallback ----
  try {
    return fs.readFileSync(filepath, 'utf8');
  } catch {
    return '';
  }
}
