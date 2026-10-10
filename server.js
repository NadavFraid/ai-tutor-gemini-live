const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('[LOG] Groq SDK Initialized');
} else {
  console.error('[WARNING] GROQ_API_KEY is missing!');
}

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

// רשימת העדפות לדגמים נתמכים
const PREFERRED_MODELS = [
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-specdec',
  'llama3-70b-8192'
];

async function getActiveGroqModel() {
  try {
    const list = await groq.models.list();
    if (list && list.data && list.data.length > 0) {
      const availableIds = list.data.map(m => m.id);
      for (const pref of PREFERRED_MODELS) {
        if (availableIds.includes(pref)) {
          return pref;
        }
      }
      // אם אף דגם מועדף לא נמצא, יילקח הדגם הראשון ברשימה הפעילה
      return list.data[0].id;
    }
  } catch (e) {
    console.error('[WARN] Could not fetch model list from Groq:', e.message);
  }
  return 'openai/gpt-oss-20b';
}

wss.on('connection', (ws, req) => {
  console.log(`[LOG] New client connected from ${req.socket.remoteAddress}`);

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'text_query') {
        console.log(`[LOG] Query received: "${parsed.text}"`);

        if (!groq) {
          ws.send(JSON.stringify({ type: 'error', message: 'חסר GROQ_API_KEY בשרת.' }));
          return;
        }

        messages.push({ role: 'user', content: parsed.text });

        const modelToUse = await getActiveGroqModel();
        console.log(`[LOG] Querying Groq using active model: ${modelToUse}`);

        const stream = await groq.chat.completions.create({
          messages: messages,
          model: modelToUse,
          temperature: 0.6,
          max_tokens: 300,
          stream: true,
        });

        let fullText = '';
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            ws.send(JSON.stringify({ type: 'text_chunk', text: content }));
          }
        }

        messages.push({ role: 'assistant', content: fullText });
        ws.send(JSON.stringify({ type: 'stream_end', fullText: fullText }));
      }
    } catch (err) {
      console.error('[ERROR] Processing failed:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => console.log('[LOG] Client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
