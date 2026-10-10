const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_INSTRUCTION = `
אתה מורה פרטי סבלני, מעודד ומקצועי לתלמיד בכיתה ח' בישראל.
שמך הוא 'אריאל'.
תפקידך לסייע במקצועות: מתמטיקה, פיזיקה, אנגלית ומדעים.
- אל תיתן את התשובות הסופיות מייד, אלא הדרך אותו צעד אחר צעד (שיטה סוקרטית).
- דבר בעברית ברורה, נעימה ובגובה העיניים.
- ענה בקצרה ובמהירות (1-2 משפטים קצרים בלבד בכל תגובה).
`;

wss.on('connection', (clientWs) => {
  console.log('[LOG] Client connected to local WebSocket');

  if (!API_KEY) {
    console.error('[ERROR] GEMINI_API_KEY is missing');
    clientWs.send(JSON.stringify({ type: 'error', message: 'חסר GEMINI_API_KEY בשרת' }));
    return;
  }

  // חיבור ל-Gemini 2.0 Multimodal Live API
  const geminiWsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
  const geminiWs = new WebSocket(geminiWsUrl);

  geminiWs.on('open', () => {
    console.log('[LOG] Connected to Gemini Multimodal Live API');

    // הודעת הגדרה ראשונית המפעילה הזרמת וידאו ואודיו
    const setupMsg = {
      setup: {
        model: 'models/gemini-2.0-flash-exp', // שימוש בדגם המולטי-מודאלי החי
        generationConfig: {
          responseModalities: ['AUDIO', 'TEXT'], // קבלת קול וטקסט מהמודל
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck' // קול אנושי ברור
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        }
      }
    };
    geminiWs.send(JSON.stringify(setupMsg));
  });

  // העברת מידע מ-Gemini אל הדפדפן של המשתמש
  geminiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());
      
      if (response.serverContent && response.serverContent.modelTurn) {
        const parts = response.serverContent.modelTurn.parts || [];
        for (const part of parts) {
          // העברת נתוני קול ווידאו של המורה
          if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
            clientWs.send(JSON.stringify({
              type: 'audio_chunk',
              data: part.inlineData.data
            }));
          }
          if (part.text) {
            clientWs.send(JSON.stringify({
              type: 'text_chunk',
              text: part.text
            }));
          }
        }
      }

      if (response.serverContent && response.serverContent.turnComplete) {
        clientWs.send(JSON.stringify({ type: 'turn_complete' }));
      }
    } catch (e) {
      console.error('[ERROR] Parsing Gemini response:', e);
    }
  });

  // העברת נתונים (מצלמה ומיקרופון) מהמשתמש אל Gemini
  clientWs.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);

      if (geminiWs.readyState === WebSocket.OPEN) {
        if (parsed.type === 'realtime_input') {
          // הזרמת פריימים של וידאו ואודיו של הילד ל-Gemini
          const realtimeMsg = {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: parsed.mimeType,
                  data: parsed.data
                }
              ]
            }
          };
          geminiWs.send(JSON.stringify(realtimeMsg));
        }
      }
    } catch (e) {
      console.error('[ERROR] Handling client message:', e);
    }
  });

  geminiWs.on('error', (err) => {
    console.error('[ERROR] Gemini WS Error:', err.message);
    clientWs.send(JSON.stringify({ type: 'error', message: 'תקלה בתקשורת מול Gemini Live' }));
  });

  clientWs.on('close', () => {
    console.log('[LOG] Client disconnected');
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
