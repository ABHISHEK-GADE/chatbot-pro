import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function tempOut(name) {
  const stamp = Date.now();
  const dir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${stamp}-${name}`);
}

async function extractPdfText(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib
    .getDocument({
      data,
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

// PDF -> DOCX (text-only)
export async function pdfToDocx(pdfPath, originalName = 'file.pdf') {
  const text = await extractPdfText(pdfPath);
  const doc = new Document({
    sections: [{ properties: {}, children: text.split('\n').map((line) => new Paragraph(line)) }]
  });
  const buff = await Packer.toBuffer(doc);
  const base = path.basename(originalName, path.extname(originalName));
  const outPath = tempOut(`${base}.docx`);
  fs.writeFileSync(outPath, buff);
  return outPath;
}

// DOCX -> PDF (basic)
export async function docxToPdf(docxPath, originalName = 'file.docx') {
  const buff = fs.readFileSync(docxPath);
  const r = await mammoth.extractRawText({ buffer: buff });
  const text = r.value || '';

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();

  const fontSize = 12;
  const margin = 50;
  const maxWidth = width - margin * 2;

  const lines = wrapText(text, font, fontSize, maxWidth);
  const lineHeight = 16;
  let y = height - margin;

  for (const l of lines) {
    if (y < margin) {
      page = pdfDoc.addPage();
      y = height - margin;
    }
    page.drawText(l, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }

  const base = path.basename(originalName, path.extname(originalName));
  const outPath = tempOut(`${base}.pdf`);
  fs.writeFileSync(outPath, await pdfDoc.save());
  return outPath;
}

// Images -> PDF
export async function imagesToPdf(imagePaths) {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imagePaths) {
    const bytes = fs.readFileSync(imgPath);
    const ext = path.extname(imgPath).toLowerCase();
    const embedded = ext === '.jpg' || ext === '.jpeg'
      ? await pdfDoc.embedJpg(bytes)
      : await pdfDoc.embedPng(bytes);
    const page = pdfDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  const outPath = tempOut(`images-${Date.now()}.pdf`);
  fs.writeFileSync(outPath, await pdfDoc.save());
  return outPath;
}

// Text -> PDF
export async function plainToPdf(text = '') {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();

  const fontSize = 12;
  const margin = 50;
  const maxWidth = width - margin * 2;

  const lines = wrapText(text, font, fontSize, maxWidth);
  const lineHeight = 16;
  let y = height - margin;

  for (const l of lines) {
    if (y < margin) {
      page = pdfDoc.addPage();
      y = height - margin;
    }
    page.drawText(l, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }

  const outPath = tempOut(`text-${Date.now()}.pdf`);
  fs.writeFileSync(outPath, await pdfDoc.save());
  return outPath;
}

function wrapText(text, font, size, maxWidth) {
  const words = (text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = (line ? line + ' ' : '') + w;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
