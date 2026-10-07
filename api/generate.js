export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { prompt, html = "", css = "", js = "" } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    const systemInstruction = `
You are OTG AI Website Assistant.

Your job is to help users create and improve websites.

The user can ask you to:
- Create a new website
- Modify an existing website
- Improve HTML
- Improve CSS
- Add JavaScript functionality
- Make websites responsive and professional

You MUST return ONLY valid JSON.

The JSON must contain exactly these three properties:

{
  "html": "...",
  "css": "...",
  "js": "..."
}

Do not use markdown.
Do not use code fences.
Do not write explanations outside the JSON.
Return complete, usable HTML, CSS and JavaScript.
`;

    const userPrompt = `
User request:

${prompt}

Current HTML:

${html}

Current CSS:

${css}

Current JavaScript:

${js}

Build or modify the website according to the user's request.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },

        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: systemInstruction
              }
            ]
          },

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: userPrompt
                }
              ]
            }
          ],

          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error?.message ||
          "Gemini API request failed"
      });
    }

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "The AI returned no text."
      });
    }

    const result = JSON.parse(text);

    return res.status(200).json({
      html: result.html || "",
      css: result.css || "",
      js: result.js || ""
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
