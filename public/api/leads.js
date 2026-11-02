javascript
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST requests only." });
  }

  if (!req.headers["content-type"]?.includes("application/json")) {
    return res.status(415).json({ error: "JSON submission required." });
  }

  const { RESEND_API_KEY, LEAD_INBOX, FROM_EMAIL } = process.env;

  if (!RESEND_API_KEY || !LEAD_INBOX || !FROM_EMAIL) {
    console.error("Missing email configuration.");
    return res.status(503).json({
      error: "The estimate form is not connected yet."
    });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "Invalid submission." });
    }

    if (body.website) {
      return res.status(400).json({ error: "Invalid submission." });
    }

    const limits = {
      name: 120,
      email: 200,
      phone: 40,
      company: 160,
      address: 300,
      details: 3000
    };

    for (const [field, limit] of Object.entries(limits)) {
      if (
        body[field] !== undefined &&
        (typeof body[field] !== "string" || body[field].length > limit)
      ) {
        return res.status(400).json({
          error: `Please check the ${field} field.`
        });
      }
    }

    const clean = value =>
      typeof value === "string" ? value.trim() : "";

    const name = clean(body.name);
    const email = clean(body.email);
    const address = clean(body.address);

    if (
      !name ||
      !address ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      /[\r\n]/.test(email)
    ) {
      return res.status(400).json({
        error: "Enter your name, valid email, and property address."
      });
    }

    const allowed = {
      propertyType: ["residential", "commercial"],
      service: [
        "recurring",
        "commercial-grounds",
        "seasonal",
        "beds-mulch",
        "multiple"
      ],
      timeline: ["flexible", "soon", "month", "next-season"]
    };

    for (const [field, options] of Object.entries(allowed)) {
      if (!options.includes(body[field])) {
        return res.status(400).json({
          error: `Please check your ${field} selection.`
        });
      }
    }

    if (
      typeof body.submissionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(body.submissionId)
    ) {
      return res.status(400).json({
        error: "Please refresh the page and submit again."
      });
    }

    const campaign = {};
    for (const field of ["source", "medium", "name", "content"]) {
      campaign[field] = clean(body.campaign?.[field]).slice(0, 200);
    }

    const text = [
      "THOMPSON LANDSCAPE — NEW ESTIMATE REQUEST",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${clean(body.phone) || "Not provided"}`,
      `Property type: ${body.propertyType}`,
      `Company/community: ${clean(body.company) || "Not provided"}`,
      `Address: ${address}`,
      `Service: ${body.service}`,
      `Preferred start: ${body.timeline}`,
      "",
      "PROPERTY DETAILS",
      clean(body.details) || "Not provided",
      "",
      `Email marketing requested: ${
        body.emailMarketingConsent === true ? "Yes" : "No"
      }`,
      "Consent text version: email-marketing-v1",
      `Received: ${new Date().toISOString()}`,
      `Submission ID: ${body.submissionId}`,
      "",
      "CAMPAIGN TRACKING",
      JSON.stringify(campaign, null, 2)
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `estimate/${body.submissionId}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [LEAD_INBOX],
        reply_to: email,
        subject: `New ${body.propertyType} landscape estimate request`,
        text
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.error("Email provider returned:", response.status);
      return res.status(502).json({
        error: "Your request could not be confirmed."
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Submission error:", error.name);

    return res.status(error instanceof SyntaxError ? 400 : 502).json({
      error: "Your request could not be confirmed."
    });
  }
}
