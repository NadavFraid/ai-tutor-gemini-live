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
  console.error("ERROR: GEMINI_API_KEY is missing from Environment Variables!");
} else {
  console.log("GEMINI_API_KEY loaded successfully.");
}

const genAI = new GoogleGenerativeAI(apiKey || '');

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים. במצב אנגלית, שלב שיחה קלה באנגלית.
- שמור על תשובות ממוקדות וקצרות כדי לאפשר שיחה קולית זורמת.
`;

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'text_query') {
        // שימוש בדגם gemini-2.0-flash העדכני
        const model = genAI.getGenerativeModel({
          model: 'gemini-3.8-flash',
          systemInstruction: SYSTEM_INSTRUCTION
        });

        const result = await model.generateContent(message.text);
        const responseText = result.response.text();

        ws.send(JSON.stringify({
          type: 'text_response',
          text: responseText
        }));
      }
    } catch (err) {
      console.error('Detailed Gemini API Error:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: `שגיאה בעיבוד הבקשה: ${err.message || 'בדוק את ה-Logs ב-Render'}`
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
