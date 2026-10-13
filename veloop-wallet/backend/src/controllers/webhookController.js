const crypto = require("crypto");
const walletService = require("../services/walletService");

const allowedEvents = new Set([
	"collection.succeeded",
	"withdrawal.succeeded",
	"withdrawal.failed"
]);

const receivePaymentEvent = async (req, res) => {
	const secret = process.env.PAYMENT_WEBHOOK_SECRET;
	if (!secret || secret.length < 32) {
		return res.status(503).json({ message: "Payment webhook is not configured." });
	}

	const timestamp = req.get("x-provider-timestamp");
	const signature = req.get("x-provider-signature");
	if (!/^\d{10}$/.test(timestamp || "") || !/^[a-f\d]{64}$/i.test(signature || "")) {
		return res.status(401).json({ message: "Invalid provider signature headers." });
	}
	if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) {
		return res.status(401).json({ message: "Provider signature timestamp has expired." });
	}

	const expected = crypto.createHmac("sha256", secret)
		.update(`${timestamp}.`)
		.update(req.rawBody || Buffer.alloc(0))
		.digest();
	const received = Buffer.from(signature, "hex");
	if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
		return res.status(401).json({ message: "Provider signature does not match." });
	}

	const { eventId, type, reference, amountCents, currency } = req.body || {};
	if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 120
		|| !allowedEvents.has(type)
		|| typeof reference !== "string" || !/^[A-Za-z0-9-]{4,80}$/.test(reference)
		|| !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 1_000_000_000
		|| currency !== "USD") {
		return res.status(400).json({ message: "Provider event payload is invalid." });
	}

	const result = await walletService.applyProviderEvent({
		event: { eventId, type, reference, amountCents, currency },
		payloadHash: crypto.createHash("sha256").update(req.rawBody).digest("hex")
	});

	return res.status(200).json({ success: true, ...result });
};

module.exports = { receivePaymentEvent };