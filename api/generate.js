export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      prompt,
      html = "",
      css = "",
      js = "",
      whatsappNumber = ""
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    function normalizeWhatsApp(number) {
      if (!number) return "";

      let value = String(number)
        .trim()
        .replace(/[^\d+]/g, "");

      if (value.startsWith("00")) {
        value = "+" + value.substring(2);
      }

      if (value.startsWith("+")) {
        return value;
      }

      if (value.startsWith("0")) {
        return "+234" + value.substring(1);
      }

      return "+" + value;
    }

    function enforceWhatsApp(html, number) {
      const normalized = normalizeWhatsApp(number);

      if (!html) return "";

      if (!normalized) {
        return html.replace(
          /<a\b[^>]*id=["']whatsappButton["'][^>]*>[\s\S]*?<\/a>/gi,
          ""
        ).replace(
          /<a\b([^>]*?)href=["']([^"']*(?:wa\.me|api\.whatsapp\.com)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi,
          "$4"
        );
      }

      const digits = normalized.replace(/\D/g, "");

      if (!digits) return html;

      const link = "https://wa.me/" + digits;

      return html.replace(
        /<a\b([^>]*?)href=["']([^"']*(?:wa\.me|api\.whatsapp\.com)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi,
        function(match, before, oldHref, after, inner) {
          return (
            "<a" +
            before +
            'href="' +
            link +
            '"' +
            after +
            ">" +
            inner +
            "</a>"
          );
        }
      );
    }

    const normalizedWhatsApp =
      normalizeWhatsApp(whatsappNumber);

    const systemInstruction = `
You are OTG AI Website Assistant.

Your job is to help users create and improve websites.

You can:
- Create new websites
- Modify existing websites
- Improve HTML
- Improve CSS
- Add JavaScript functionality
- Make websites responsive
- Make websites professional and attractive
- Make websites mobile-friendly

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

IMPORTANT WHATSAPP RULES:

- Never invent a WhatsApp number.
- Never guess a WhatsApp number.
- Never use a random WhatsApp number.
- If a WhatsApp number is supplied, use ONLY the supplied number.
- If no WhatsApp number is supplied, do NOT create a WhatsApp link or WhatsApp button.
- Do not replace the supplied WhatsApp number with another number.
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

WhatsApp number supplied by the user:

${normalizedWhatsApp || "NONE"}

Build or modify the website according to the user's request.

If a WhatsApp number is supplied, use ONLY:

${normalizedWhatsApp || "NONE"}

If it says NONE, do not create any WhatsApp link or button.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
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

    let result;

    try {
      result = JSON.parse(text);
    } catch (parseError) {
      return res.status(500).json({
        error: "The AI returned invalid website data."
      });
    }

    const finalHtml =
      enforceWhatsApp(
        result.html || "",
        normalizedWhatsApp
      );

    return res.status(200).json({
      html: finalHtml,
      css: result.css || "",
      js: result.js || ""
    });

  } catch (error) {
    return res.status(500).json({
      error:
        error.message ||
        "Server error"
    });
  }
}
