// Vercel serverless endpoint for the OTG admin-only AI assistant.
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  res.setHeader("Vary", "Authorization");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const aiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !publishableKey || !aiKey) {
    return reply(res, 503, {
      error: "The assistant is not configured yet. An administrator must configure the server-side AI and Supabase environment variables."
    });
  }

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return reply(res, 401, { error: "Please sign in again." });

  try {
    // Validate the caller's access token with Supabase Auth, not client-supplied user IDs.
    const userResponse = await fetch(supabaseUrl.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { apikey: publishableKey, Authorization: "Bearer " + match[1] }
    });
    if (!userResponse.ok) return reply(res, 401, { error: "Your session is invalid or expired. Please sign in again." });
    const user = await userResponse.json();
    if (!user || !user.id) return reply(res, 401, { error: "Please sign in again." });

    // Read the caller's own authoritative role and approval state using their session token and Supabase row-level security.
    const profileUrl = supabaseUrl.replace(/\/$/, "") + "/rest/v1/profiles?id=eq." +
      encodeURIComponent(user.id) + "&select=role,approval_status&limit=1";
    const profileResponse = await fetch(profileUrl, {
      headers: { apikey: publishableKey, Authorization: "Bearer " + match[1] }
    });
    if (!profileResponse.ok) return reply(res, 503, { error: "Could not verify administrator access." });
    const profiles = await profileResponse.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || String(profile.role || "").toLowerCase() !== "admin" ||
        String(profile.approval_status || "").toLowerCase() !== "approved") {
      return reply(res, 403, { error: "Administrator access is required." });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) {
      return reply(res, 400, { error: "Send between 1 and 20 chat messages." });
    }
    const messages = body.messages.map(item => {
      const role = item && item.role;
      const content = typeof (item && item.content) === "string" ? item.content.trim() : "";
      if (!["user", "assistant"].includes(role) || !content || content.length > MAX_MESSAGE_CHARS) {
        throw new Error("Invalid chat message.");
      }
      return { role, content };
    });
    if (messages[messages.length - 1].role !== "user") {
      return reply(res, 400, { error: "The latest message must be a user message." });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + aiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OTG_AI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are the OTG GRAPHIC Academy internal admin assistant. Help the authorized academy administrator plan and troubleshoot academy operations, lessons, assignments, student support, and website features. Be accurate, concise, and security-conscious. Do not claim to have changed the live website, database, student records, or deployments unless a tool actually performed that action. Never request passwords, API keys, or student secrets." },
          ...messages
        ],
        temperature: 0.3,
        max_tokens: 1200
      })
    });
    const result = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      const status = aiResponse.status === 429 ? 429 : 502;
      return reply(res, status, { error: aiResponse.status === 429
        ? "The AI service is busy or its usage limit was reached. Please try again shortly."
        : "The AI service could not complete the request. Check the server-side API key and provider settings." });
    }
    const answer = result && result.choices && result.choices[0] && result.choices[0].message &&
      result.choices[0].message.content;
    if (typeof answer !== "string" || !answer.trim()) return reply(res, 502, { error: "The AI returned an empty response. Please try again." });
    return reply(res, 200, { answer: answer.trim() });
  } catch (error) {
    if (error && error.message === "Invalid chat message.") return reply(res, 400, { error: error.message });
    return reply(res, 500, { error: "The assistant encountered an unexpected error. Please try again." });
  }
};
