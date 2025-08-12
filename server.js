import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toText } from './utils/fileToText.js';
import {
  pdfToDocx,
  docxToPdf,
  imagesToPdf,
  plainToPdf
} from './utils/convert.js';
import mime from 'mime-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Init clients if keys exist
const openaiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/** ---------- Sanitizer to prevent `input_image` errors ---------- **/
function sanitizeOpenAIContent(content) {
  return (content || []).map(part => {
    if (!part || typeof part !== 'object') return part;
    if (part.type === 'input_image') {
      const raw = part.image_url || part.image || part.url || part.data || '';
      const url = typeof raw === 'string' ? raw : (raw?.url || '');
      return { type: 'image_url', image_url: { url } };
    }
    if (part.type === 'image_url' && typeof part.image_url === 'string') {
      return { type: 'image_url', image_url: { url: part.image_url } };
    }
    return part;
  });
}

function sanitizeOpenAIMessages(messages) {
  return (messages || []).map(m => {
    if (!m || typeof m !== 'object') return m;
    if (Array.isArray(m.content)) {
      return { ...m, content: sanitizeOpenAIContent(m.content) };
    }
    return m;
  });
}

// --- Chat endpoint (text only; kept for compatibility) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { provider = 'openai', prompt, history = [] } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Empty prompt' });
    }

    if (provider === 'gemini') {
      if (!genAI) return res.status(400).json({ error: 'Gemini key missing' });
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

      const contents = [];
      for (const m of (history || [])) {
        const text = (typeof m?.content === 'string' ? m.content : m?.text) || '';
        if (!text.trim()) continue;
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }]
        });
      }
      contents.push({
        role: 'user',
        parts: [{ text: String(prompt || '').trim() }]
      });

      const result = await model.generateContent({ contents });
      const text = result.response.text() || '';
      return res.json({ text });

    } else {
      if (!openai) return res.status(400).json({ error: 'OpenAI key missing' });
      let messages = [
        ...history
          .map(m => {
            const c = typeof m?.content === 'string' ? m.content : (m?.text || '');
            if (!c?.trim()) return null;
            return { role: m.role, content: c };
          })
          .filter(Boolean),
        { role: 'user', content: String(prompt).trim() }
      ];
      messages = sanitizeOpenAIMessages(messages);

      const r = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.6
      });
      const text = r.choices?.[0]?.message?.content?.trim() || '';
      return res.json({ text });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Chat failed', detail: String(e?.message || e) });
  }
});

// Chat with files
app.post('/api/chat-with-files', upload.array('files', 10), async (req, res) => {
  const cleanup = () => {
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
  };

  try {
    const provider = req.body.provider || 'openai';
    const prompt = (req.body.prompt || '').toString();
    if (!prompt.trim() && (!req.files || !req.files.length)) {
      cleanup();
      return res.status(400).json({ error: 'Empty prompt' });
    }

    let history = [];
    try {
      const raw = req.body.history;
      if (raw) history = JSON.parse(raw);
    } catch {}

    const images = [];
    const texts  = [];
    for (const f of (req.files || [])) {
      const mimeType = (mime.lookup(f.originalname) || f.mimetype || '').toString();
      if (mimeType.startsWith('image/')) {
        const base64 = fs.readFileSync(f.path, { encoding: 'base64' });
        images.push({ filename: f.originalname, base64, mimeType });
      } else {
        const text = await toText(f.path, f.originalname);
        if (text && text.trim()) {
          texts.push({ filename: f.originalname, text });
        }
      }
    }

    let answer = '';

    if (provider === 'gemini') {
      if (!genAI) { cleanup(); return res.status(400).json({ error: 'Gemini key missing' }); }
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

      const contents = [];
      for (const m of (history || [])) {
        const text = (typeof m?.content === 'string' ? m.content : m?.text) || '';
        if (!text.trim()) continue;
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
      }

      const parts = [];
      if (prompt && prompt.trim()) parts.push({ text: prompt.trim() });

      if (texts.length) {
        parts.push({ text: `\nAttached documents (extracted text):\n` });
        for (const t of texts) {
          parts.push({ text: `--- ${t.filename} ---\n${(t.text || '').trim()}\n` });
        }
      }
      for (const img of images) {
        parts.push({
          inlineData: { data: img.base64, mimeType: img.mimeType }
        });
      }

      contents.push({ role: 'user', parts });
      const result = await model.generateContent({ contents });
      answer = result.response.text() || '';

    } else {
      if (!openai) { cleanup(); return res.status(400).json({ error: 'OpenAI key missing' }); }

      const messages = [
        ...history
          .map(m => {
            const c = typeof m?.content === 'string' ? m.content : (m?.text || '');
            if (!c?.trim()) return null;
            return { role: m.role, content: c };
          })
          .filter(Boolean),
      ];

      const content = [];
      if (prompt && prompt.trim()) content.push({ type: 'text', text: prompt.trim() });

      if (texts.length) {
        let combined = '\nAttached documents (extracted text):\n';
        for (const t of texts) {
          const block = (t.text || '').trim();
          if (block) combined += `--- ${t.filename} ---\n${block}\n`;
        }
        content.push({ type: 'text', text: combined });
      }

      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        });
      }

      if (!content.length) content.push({ type: 'text', text: '(no content)' });
      messages.push({ role: 'user', content });

      const safeMessages = sanitizeOpenAIMessages(messages);

      const r = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: safeMessages,
        temperature: 0.6
      });
      answer = r.choices?.[0]?.message?.content?.trim() || '';
    }

    cleanup();
    res.json({ text: answer });

  } catch (e) {
    console.error(e);
    cleanup();
    res.status(500).json({ error: 'Chat-with-files failed', detail: String(e?.message || e) });
  }
});

// Analyze
app.post('/api/analyze', upload.array('files', 10), async (req, res) => {
  try {
    const { provider = 'openai', question = 'Summarize this file.' } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const images = [];
    const texts = [];

    for (const f of req.files) {
      const mimeType = mime.lookup(f.originalname) || f.mimetype;
      if (mimeType && String(mimeType).startsWith('image/')) {
        const base64 = fs.readFileSync(f.path, { encoding: 'base64' });
        images.push({ filename: f.originalname, base64, mimeType: String(mimeType) });
      } else {
        const text = await toText(f.path, f.originalname);
        texts.push({ filename: f.originalname, text });
      }
    }

    let answer = '';
    if (provider === 'gemini') {
      if (!genAI) return res.status(400).json({ error: 'Gemini key missing' });
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

      const parts = [];
      if (texts.length) {
        parts.push({ text: `You will get extracted text from files. Task: ${question}\n\n` });
        for (const t of texts) {
          const block = (t.text || '').trim();
          if (block) parts.push({ text: `--- ${t.filename} ---\n${block}\n` });
        }
      }
      for (const img of images) {
        parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
      }

      const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
      answer = result.response.text() || '';

    } else {
      if (!openai) return res.status(400).json({ error: 'OpenAI key missing' });
      const content = [];

      if (texts.length) {
        let combined = `You will get extracted text from files. Task: ${question}\n\n`;
        for (const t of texts) {
          const block = (t.text || '').trim();
          if (block) combined += `--- ${t.filename} ---\n${block}\n`;
        }
        content.push({ type: 'text', text: combined });
      }

      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
        });
      }

      const safeMessages = sanitizeOpenAIMessages([{ role: 'user', content }]);

      const r = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: safeMessages,
        temperature: 0.4
      });
      answer = r.choices?.[0]?.message?.content?.trim() || '';
    }

    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    res.json({ text: answer });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Analyze failed', detail: String(e?.message || e) });
  }
});

// Converters
app.post('/api/convert/pdf-to-docx', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No PDF uploaded' });

    const outPath = await pdfToDocx(file.path, file.originalname);
    res.download(outPath, path.basename(outPath), () => {
      fs.unlink(file.path, () => {});
      fs.unlink(outPath, () => {});
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Conversion failed', detail: String(e?.message || e) });
  }
});

app.post('/api/convert/docx-to-pdf', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No DOCX uploaded' });

    const outPath = await docxToPdf(file.path, file.originalname);
    res.download(outPath, path.basename(outPath), () => {
      fs.unlink(file.path, () => {});
      fs.unlink(outPath, () => {});
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Conversion failed', detail: String(e?.message || e) });
  }
});

app.post('/api/convert/images-to-pdf', upload.array('files', 50), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No images uploaded' });

    const outPath = await imagesToPdf(files.map(f => f.path));
    res.download(outPath, path.basename(outPath), () => {
      files.forEach(f => fs.unlink(f.path, () => {}));
      fs.unlink(outPath, () => {});
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Conversion failed', detail: String(e?.message || e) });
  }
});

app.post('/api/convert/text-to-pdf', async (req, res) => {
  try {
    const { text = '' } = req.body;
    const outPath = await plainToPdf(text);
    res.download(outPath, path.basename(outPath), () => {
      fs.unlink(outPath, () => {});
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Conversion failed', detail: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
