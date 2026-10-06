export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, html = "", css = "", js = "" } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `You are OTG AI Website Assistant.

Help users build and improve websites.

Return ONLY valid JSON with exactly these three properties:
{
  "html": "...",
  "css": "...",
  "js": "..."
}

Do not use markdown.
Do not include explanations outside the JSON.
Keep the HTML, CSS and JavaScript complete and usable.`
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `User request:
${prompt}

Current HTML:
${html}

Current CSS:
${css}

Current JavaScript:
${js}

Build or modify the website according to the user's request.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "OpenAI request failed"
      });
    }

    const text = data.output_text;

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
