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
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

const CANDIDATE_MODELS = [
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'mixtral-8x7b-32768'
];

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

        let stream = null;
        let usedModel = '';

        // ניסיון יצירת סטרים עם מנגנון Fallback אוטומטי בין המודלים
        for (const modelId of CANDIDATE_MODELS) {
          try {
            stream = await groq.chat.completions.create({
              messages: messages,
              model: modelId,
              temperature: 0.6,
              max_tokens: 250,
              stream: true,
            });
            usedModel = modelId;
            console.log(`[LOG] Successfully stream started with model: ${modelId}`);
            break;
          } catch (modelErr) {
            console.warn(`[WARN] Model ${modelId} failed:`, modelErr.message);
          }
        }

        if (!stream) {
          throw new Error('כל דגמי Groq עמוסים כרגע. נסה שוב בעוד כמה שניות.');
        }

        let fullText = '';
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            ws.send(JSON.stringify({ type: 'text_chunk', text: content }));
          }
        }

        messages.push({ role: 'assistant', content: fullText });
        console.log(`[LOG] Completed in ${Date.now() - startTime}ms via ${usedModel}`);
        ws.send(JSON.stringify({ type: 'stream_end', fullText: fullText }));
      }
    } catch (err) {
      console.error('[ERROR] WS Handling Error:', err.message);
      ws.send(JSON.stringify({
        type: 'error',
        message: err.message || 'חלה שגיאה בתקשורת מול השרת.'
      }));
    }
  });

  ws.on('close', () => console.log('[LOG] Client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
