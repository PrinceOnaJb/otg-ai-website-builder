module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];
  const urls = String(process.env.OTG_TURN_URLS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const username = process.env.OTG_TURN_USERNAME || "";
  const credential = process.env.OTG_TURN_CREDENTIAL || "";

  if (urls.length && username && credential) {
    iceServers.push({ urls, username, credential });
  }

  return res.status(200).json({
    iceServers,
    turnConfigured: urls.length > 0 && Boolean(username && credential)
  });
};
