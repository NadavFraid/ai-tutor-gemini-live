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
- שמור על תשובות ממוקדות וקצרות כדי לאפשר שיחה קולית זורמת (עד 2-3 משפטים לתגובה).
`;

// פונקציית עזר להזרמת תוכן עם ניסיון חוזר במקרה של שגיאת 500 זמנית
async function streamWithRetry(model, text, ws, retries = 2) {
  try {
    const resultStream = await model.generateContentStream(text);
    for await (const chunk of resultStream.stream) {
      const chunkText = chunk.text();
      ws.send(JSON.stringify({
        type: 'text_chunk',
        text: chunkText
      }));
    }
    ws.send(JSON.stringify({ type: 'stream_end' }));
  } catch (err) {
    if (retries > 0 && err.message && err.message.includes('500')) {
      console.log(`Temporary 500 error encountered. Retrying... (${retries} left)`);
      await new Promise(res => setTimeout(res, 1000)); // המתונה של שנייה לפני ניסיון חוזר
      return streamWithRetry(model, text, ws, retries - 1);
    }
    throw err;
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        const model = genAI.getGenerativeModel({
          model: 'gemini-3.8-flash',
          systemInstruction: SYSTEM_INSTRUCTION
        });

        await streamWithRetry(model, message.text, ws);
      }
    } catch (err) {
      console.error('Error in streaming:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'הייתה אי-יציבות רגעית בחיבור ל-Google, אנא נסה לשלוח את ההודעה שוב.'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
