const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is not defined in environment variables!");
}

const genAI = new GoogleGenerativeAI(apiKey || '');

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

// הגדרת המודל הנתמך הראשי לפי הוראת גוגל
const MODEL_NAME = 'gemini-3.8-flash';

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected via WebSocket');
  const history = [];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const message = JSON.parse(data);
      console.log(`[LOG] Query received: "${message.text}" using model: ${MODEL_NAME}`);

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: SYSTEM_INSTRUCTION
      });

      history.push({ role: 'user', parts: [{ text: message.text }] });

      const resultStream = await model.generateContentStream({ contents: history });

      let fullModelResponse = '';
      let firstChunk = true;

      for await (const chunk of resultStream.stream) {
        if (firstChunk) {
          console.log(`[LOG] First chunk received in ${Date.now() - startTime}ms`);
          firstChunk = false;
        }
        const chunkText = chunk.text();
        fullModelResponse += chunkText;
        ws.send(JSON.stringify({ type: 'text_chunk', text: chunkText }));
      }

      history.push({ role: 'model', parts: [{ text: fullModelResponse }] });
      console.log(`[LOG] Response finished in ${Date.now() - startTime}ms`);
      ws.send(JSON.stringify({ type: 'stream_end' }));

    } catch (err) {
      console.error('[ERROR] Request failed:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאה: ${err.message || 'תקלת תקשורת מול Google'}`
      }));
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
