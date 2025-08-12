// ---------- DOM ----------
const chatBody   = document.getElementById('chat-body');
const userInput  = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const providerSel= document.getElementById('provider');
const clearBtn   = document.getElementById('clear');

const exportBtn   = document.getElementById('export-chat');
const themeToggle = document.getElementById('theme-toggle');
const toast       = document.getElementById('toast');

// Analyze
const analyzeForm = document.getElementById('analyze-form');
const filesInput  = document.getElementById('files');
const drop        = document.getElementById('drop');
const question    = document.getElementById('question');
const fileChips   = document.getElementById('file-chips');

// Converters
const pdf2docx    = document.getElementById('pdf2docx');
const btnPdf2docx = document.getElementById('btn-pdf2docx');
const docx2pdf    = document.getElementById('docx2pdf');
const btnDocx2pdf = document.getElementById('btn-docx2pdf');
const imgs2pdf    = document.getElementById('imgs2pdf');
const btnImgs2pdf = document.getElementById('btn-imgs2pdf');
const txt2pdf     = document.getElementById('txt2pdf');
const btnTxt2pdf  = document.getElementById('btn-txt2pdf');

// Chat attachments
const attachBtn      = document.getElementById('attach');
const chatFilesInput = document.getElementById('chat-files');
const chatFileChips  = document.getElementById('chat-file-chips');

let history = []; // {role:'user'|'assistant', content:'text'}

// ---------- Utils ----------
const nowTime = () => new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

// Render markdown into an element
function renderMarkdown(el, text) {
  const html = marked.parse(text || '');
  el.innerHTML = html;

  // Add copy buttons to each code block
  el.querySelectorAll('pre > code').forEach(code => {
    const pre = code.parentElement;
    const btn = document.createElement('button');
    btn.className = 'copy-code';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(code.innerText);
      btn.textContent = 'Copied!';
      setTimeout(()=>btn.textContent='Copy', 1200);
    });
    pre.appendChild(btn);
  });

  // Open links in new tabs safely
  el.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}

function createMsg(who = 'bot', content = '', attachments = []) {
  const tpl = document.getElementById('msg-template');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.classList.toggle('user', who === 'user');
  node.classList.toggle('bot',  who !== 'user');

  const avatar = node.querySelector('.avatar');
  avatar.textContent = who === 'user' ? '🧑' : '🤖';
  node.querySelector('.who').textContent = who === 'user' ? 'You' : 'Assistant';
  node.querySelector('.time').textContent = nowTime();

  const contentEl = node.querySelector('.content');

  // If user had image attachments, preview them
  if (who === 'user' && attachments?.length) {
    const wrap = document.createElement('div');
    wrap.className = 'preview-row';
    attachments.forEach(file => {
      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.className = 'preview';
        img.alt = file.name;
        img.src = URL.createObjectURL(file);
        wrap.appendChild(img);
      } else {
        const pill = document.createElement('span');
        pill.className = 'file-pill';
        pill.textContent = file.name;
        wrap.appendChild(pill);
      }
    });
    contentEl.appendChild(wrap);
  }

  renderMarkdown(contentEl, content || (who === 'bot' ? '…' : ''));

  // Copy whole message
  node.querySelector('.copy').addEventListener('click', async () => {
    const plain = contentEl.innerText.trim();
    await navigator.clipboard.writeText(plain);
    showToast('Copied');
  });

  chatBody.appendChild(node);
  chatBody.scrollTop = chatBody.scrollHeight;
  return node;
}

function setTyping(node, on = true) {
  const el = node.querySelector('.content');
  if (on) {
    el.innerHTML = '<span class="typing"></span>';
  }
}

// Attachment chips row
attachBtn?.addEventListener('click', () => chatFilesInput?.click());
chatFilesInput?.addEventListener('change', renderChatFileChips);

function renderChatFileChips() {
  if (!chatFileChips) return;
  chatFileChips.innerHTML = '';
  Array.from(chatFilesInput?.files || []).forEach((f, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${f.name}</span> <button class="rm" title="Remove">✕</button>`;
    chip.querySelector('.rm').addEventListener('click', () => removeChatFileAt(idx));
    chatFileChips.appendChild(chip);
  });
}
function removeChatFileAt(i) {
  const dt = new DataTransfer();
  Array.from(chatFilesInput.files).forEach((f, idx) => { if (idx !== i) dt.items.add(f); });
  chatFilesInput.files = dt.files;
  renderChatFileChips();
}
function clearChatAttachments() {
  if (!chatFilesInput) return;
  const dt = new DataTransfer();
  chatFilesInput.files = dt.files;
  renderChatFileChips();
}

// ---------- Theme ----------
(function initTheme(){
  if (!themeToggle) return;
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
})();

// ---------- Export chat ----------
exportBtn?.addEventListener('click', () => {
  const lines = [...chatBody.querySelectorAll('.msg')].map(m => {
    const who = m.classList.contains('user') ? 'You' : 'Assistant';
    const text = m.querySelector('.content')?.innerText || '';
    return `${who}: ${text}`;
  });
  const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `chat-${Date.now()}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Exported');
});

// ---------- Chat ----------
async function sendChat() {
  const text = userInput.value.trim();
  const files = Array.from(chatFilesInput?.files || []);
  const hasFiles = files.length > 0;
  if (!text && !hasFiles) return;

  // User bubble
  createMsg('user', text || `Sent ${files.length} attachment(s)`, files);
  history.push({ role: 'user', content: text || '[attachments]' });

  // Reset input
  userInput.value = ''; userInput.style.height = 'auto';

  // Bot thinking bubble
  const botNode = createMsg('bot', '');
  setTyping(botNode, true);

  try {
    const provider = providerSel?.value || 'openai';

    if (hasFiles) {
      const form = new FormData();
      form.append('provider', provider);
      form.append('prompt', text);
      form.append('history', JSON.stringify(history));
      files.forEach(f => form.append('files', f));

      const r = await fetch('/api/chat-with-files', { method: 'POST', body: form });
      const json = await r.json();

      renderMarkdown(botNode.querySelector('.content'), json.text || (`**Error:** ${json.error || 'Unknown'}`));
      if (json.text) history.push({ role: 'assistant', content: json.text });

    } else {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ provider, prompt: text, history })
      });
      const json = await r.json();
      renderMarkdown(botNode.querySelector('.content'), json.text || (`**Error:** ${json.error || 'Unknown'}`));
      if (json.text) history.push({ role: 'assistant', content: json.text });
    }
  } catch (err) {
    renderMarkdown(botNode.querySelector('.content'), `**Error:** ${err?.message || err}`);
  } finally {
    clearChatAttachments();
    botNode.querySelector('.time').textContent = nowTime();
    chatBody.scrollTop = chatBody.scrollHeight;
  }
}

// Enter to send; Shift+Enter for newline + autoresize
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 220) + 'px';
});
sendButton.addEventListener('click', sendChat);

clearBtn?.addEventListener('click', () => {
  history = [];
  chatBody.innerHTML = '';
  showToast('Chat cleared');
});

// ---------- Analyze ----------
;['dragenter','dragover'].forEach(ev => drop?.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation(); drop.style.borderColor = '#6c9cff';
}));
;['dragleave','drop'].forEach(ev => drop?.addEventListener(ev, e => {
  e.preventDefault(); e.stopPropagation(); drop.style.borderColor = '';
}));
drop?.addEventListener('drop', (e) => { filesInput.files = e.dataTransfer.files; renderChips(); });
filesInput?.addEventListener('change', renderChips);

function renderChips() {
  if (!fileChips) return;
  fileChips.innerHTML = '';
  Array.from(filesInput.files || []).forEach((f, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${f.name}</span> <button class="rm" title="Remove">✕</button>`;
    chip.querySelector('.rm').addEventListener('click', () => removeFileAtIndex(idx));
    fileChips.appendChild(chip);
  });
}
function removeFileAtIndex(i) {
  const dt = new DataTransfer();
  Array.from(filesInput.files).forEach((f, idx) => { if (idx !== i) dt.items.add(f); });
  filesInput.files = dt.files; renderChips();
}

analyzeForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const provider = providerSel?.value || 'openai';
  const form = new FormData();
  Array.from(filesInput.files || []).forEach(f => form.append('files', f));
  form.append('provider', provider);
  form.append('question', question?.value || 'Summarize this.');

  if (!filesInput.files?.length) return showToast('Select files first');

  createMsg('user', `Analyzing ${filesInput.files.length} file(s)…`);
  try {
    const r = await fetch('/api/analyze', { method: 'POST', body: form });
    const json = await r.json();
    createMsg('bot', json.text || (`**Error:** ${json.error || 'Unknown'}`));
    if (json.text) history.push({ role: 'assistant', content: json.text });
  } catch (err) {
    createMsg('bot', `**Error:** ${err?.message || err}`);
  }
});

// ---------- Converters ----------
btnPdf2docx?.addEventListener('click', async () => {
  if (!pdf2docx?.files?.[0]) return alert('Choose a PDF');
  const form = new FormData();
  form.append('file', pdf2docx.files[0]);
  const r = await fetch('/api/convert/pdf-to-docx', { method: 'POST', body: form });
  if (!r.ok) return alert('Conversion failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const name = pdf2docx.files[0].name.replace(/\.[^.]+$/, '') + '.docx';
  download(url, name);
});

btnDocx2pdf?.addEventListener('click', async () => {
  if (!docx2pdf?.files?.[0]) return alert('Choose a DOCX');
  const form = new FormData();
  form.append('file', docx2pdf.files[0]);
  const r = await fetch('/api/convert/docx-to-pdf', { method: 'POST', body: form });
  if (!r.ok) return alert('Conversion failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const name = docx2pdf.files[0].name.replace(/\.[^.]+$/, '') + '.pdf';
  download(url, name);
});

btnImgs2pdf?.addEventListener('click', async () => {
  if (!imgs2pdf?.files?.length) return alert('Choose image(s)');
  const form = new FormData();
  Array.from(imgs2pdf.files).forEach(f => form.append('files', f));
  const r = await fetch('/api/convert/images-to-pdf', { method: 'POST', body: form });
  if (!r.ok) return alert('Conversion failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  download(url, `images-${Date.now()}.pdf`);
});

btnTxt2pdf?.addEventListener('click', async () => {
  const text = (txt2pdf?.value || '').trim();
  if (!text) return alert('Enter some text');
  const r = await fetch('/api/convert/text-to-pdf', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ text })
  });
  if (!r.ok) return alert('Export failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  download(url, `text-${Date.now()}.pdf`);
});

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Tabs (Converters) ----------
(function initTabs(){
  const tabs   = document.querySelectorAll('.tabs .tab');
  const panels = document.querySelectorAll('.tab-panels .panel-tab');
  if (!tabs.length || !panels.length) return;

  function activate(tab) {
    tabs.forEach(t => {
      const sel = t === tab;
      t.classList.toggle('active', sel);
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
    });
    panels.forEach(p => { p.classList.remove('active'); p.hidden = true; });
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    if (panel) { panel.classList.add('active'); panel.hidden = false; }
  }
  tabs.forEach(t => {
    t.addEventListener('click', () => activate(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t); }
    });
  });
  activate(document.querySelector('.tabs .tab.active') || tabs[0]);
})();
