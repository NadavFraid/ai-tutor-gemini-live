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

const MODEL_NAME = 'gemini-3.8-flash';

// פונקציה להזרמת תוכן עם ניסיון חוזר אוטומטי במקרה של עומס רגעי (503)
async function streamWithRetry(model, contents, ws, retries = 3, delayMs = 600) {
  try {
    const resultStream = await model.generateContentStream({ contents });
    return resultStream;
  } catch (err) {
    if (retries > 0 && (err.status === 503 || err.status === 429 || (err.message && err.message.includes('503')))) {
      console.log(`[LOG] 503/High demand encountered. Retrying in ${delayMs}ms... (${retries} retries left)`);
      await new Promise(res => setTimeout(res, delayMs));
      return streamWithRetry(model, contents, ws, retries - 1, delayMs * 1.5);
    }
    throw err;
  }
}

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
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          maxOutputTokens: 250, // הגבלת אורך התשובה למקסום מהירות התגובה
          temperature: 0.7
        }
      });

      history.push({ role: 'user', parts: [{ text: message.text }] });

      // ביצוע קריאה מוגנת בעומס
      const resultStream = await streamWithRetry(model, history, ws);

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
        message: 'היה עומס זמני בשרת, נסה לשלוח את ההודעה שוב.'
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
