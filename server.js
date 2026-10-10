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
  console.error("ERROR: GEMINI_API_KEY is not defined!");
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

// פונקציה לזיהוי אקטיבי של המודל הנתמך הזמין בחשבון
async function getWorkingModelName() {
  try {
    // ננסה להשתמש במודל הסטנדרטי השכיח
    return 'gemini-1.5-flash-latest';
  } catch (err) {
    return 'gemini-1.5-flash';
  }
}

wss.on('connection', (ws) => {
  console.log('[LOG] Client connected via WebSocket');
  const history = [];

  ws.on('message', async (data) => {
    const startTime = Date.now();
    try {
      const message = JSON.parse(data);
      console.log(`[LOG] User asked: "${message.text}"`);

      // שימוש בגרסה היציבה שנקראת flash-latest
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash-latest',
        systemInstruction: SYSTEM_INSTRUCTION
      });

      history.push({ role: 'user', parts: [{ text: message.text }] });

      const resultStream = await model.generateContentStream({ contents: history });

      let fullModelResponse = '';
      let firstChunk = true;

      for await (const chunk of resultStream.stream) {
        if (firstChunk) {
          console.log(`[LOG] Response started in ${Date.now() - startTime}ms`);
          firstChunk = false;
        }
        const chunkText = chunk.text();
        fullModelResponse += chunkText;
        ws.send(JSON.stringify({ type: 'text_chunk', text: chunkText }));
      }

      history.push({ role: 'model', parts: [{ text: fullModelResponse }] });
      console.log(`[LOG] Completed in ${Date.now() - startTime}ms`);
      ws.send(JSON.stringify({ type: 'stream_end' }));

    } catch (err) {
      console.error('[ERROR] Details:', err);
      
      // אם יש שגיאה עם gemini-1.5-flash-latest, ננסה גיבוי יציב
      try {
        console.log('[LOG] Retrying with fallback model gemini-pro...');
        const fallbackModel = genAI.getGenerativeModel({
          model: 'gemini-pro',
          systemInstruction: SYSTEM_INSTRUCTION
        });
        
        const message = JSON.parse(data);
        const result = await fallbackModel.generateContent(message.text);
        ws.send(JSON.stringify({ type: 'text_chunk', text: result.response.text() }));
        ws.send(JSON.stringify({ type: 'stream_end' }));
      } catch (fallbackErr) {
        ws.send(JSON.stringify({
          type: 'error',
          message: `שגיאת תקשורת מול גוגל: ${err.message}`
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('[LOG] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
