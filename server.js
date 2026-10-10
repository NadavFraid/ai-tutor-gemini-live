const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

const VALID_GROQ_CHAT_MODELS = [
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b'
];

let activeModelId = null;

async function getAvailableModel() {
  try {
    const list = await groq.models.list();
    if (list && list.data) {
      const availableIds = list.data.map(m => m.id);
      for (const candidate of VALID_GROQ_CHAT_MODELS) {
        if (availableIds.includes(candidate)) {
          console.log(`[LOG] Selected active Groq model: ${candidate}`);
          return candidate;
        }
      }
    }
  } catch (err) {
    console.error('[ERROR] Failed fetching models list:', err.message);
  }
  return 'openai/gpt-oss-20b';
}

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected');
  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'text_query') {
        console.log(`[LOG] User asked: "${parsed.text}"`);
        messages.push({ role: 'user', content: parsed.text });

        if (!activeModelId) {
          activeModelId = await getAvailableModel();
        }

        const stream = await groq.chat.completions.create({
          messages: messages,
          model: activeModelId,
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
        console.log(`[LOG] Response time: ${Date.now() - startTime}ms`);
        ws.send(JSON.stringify({ type: 'stream_end', fullText }));
      }
    } catch (err) {
      console.error('[ERROR] Processing error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'חלה שגיאה בתקשורת. נסה שוב.' }));
    }
  });

  ws.on('close', () => console.log('[LOG] Client disconnected'));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
