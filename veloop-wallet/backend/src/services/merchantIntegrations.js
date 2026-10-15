class MerchantIntegrationError extends Error {
	constructor(message, statusCode = 503) {
		super(message);
		this.statusCode = statusCode;
		this.expose = true;
	}
}

const INR_WALLET_ACCOUNTING_READY = false;

const createMerchantIntegrations = ({
	amazonGiftCardIssuer,
	voucherIssuer,
	razorpayCheckout,
	razorpayPayouts
} = {}) => {
	const hasAdapterMethod = (provider, method) => typeof provider?.[method] === "function";
	const isEnabled = (key, provider, method) => process.env[key] === "true" && hasAdapterMethod(provider, method);

	const capabilities = () => ({
		currency: {
			code: "USD",
			inrEnabled: false,
			inrReason: "INR wallet accounting is not implemented; real INR flows remain disabled."
		},
		amazonGiftCards: {
			provider: "Amazon AGCOD",
			enabled: isEnabled("AMAZON_AGCOD_ENABLED", amazonGiftCardIssuer, "issueGiftCard"),
			reason: !hasAdapterMethod(amazonGiftCardIssuer, "issueGiftCard")
				? "Waiting for approved Amazon AGCOD account and issuer adapter."
				: process.env.AMAZON_AGCOD_ENABLED !== "true"
					? "Disabled until Amazon AGCOD account approval and prefunding."
					: null
		},
		merchantVouchers: {
			provider: process.env.VOUCHER_ISSUER || null,
			enabled: isEnabled("MERCHANT_VOUCHERS_ENABLED", voucherIssuer, "issueVoucher"),
			reason: !hasAdapterMethod(voucherIssuer, "issueVoucher")
				? "Waiting for an eligible voucher provider and fulfillment adapter."
				: process.env.MERCHANT_VOUCHERS_ENABLED !== "true"
					? "Disabled until an eligible voucher provider is selected and approved."
					: null
		},
		razorpayCheckout: {
			provider: "Razorpay Checkout",
			enabled: isEnabled("RAZORPAY_CHECKOUT_ENABLED", razorpayCheckout, "createOrder")
				&& process.env.INR_WALLET_ENABLED === "true"
				&& INR_WALLET_ACCOUNTING_READY,
			reason: !hasAdapterMethod(razorpayCheckout, "createOrder")
				? "Waiting for an approved Razorpay merchant account and checkout adapter."
				: process.env.RAZORPAY_CHECKOUT_ENABLED !== "true"
					? "Disabled until Razorpay Checkout onboarding is complete."
					: process.env.INR_WALLET_ENABLED !== "true"
						? "Disabled until the INR wallet and paise accounting are configured."
						: "Disabled until INR wallet accounting is implemented."
		},
		razorpayPayouts: {
			provider: "RazorpayX Payouts",
			enabled: isEnabled("RAZORPAYX_PAYOUTS_ENABLED", razorpayPayouts, "createPayout")
				&& process.env.INR_WALLET_ENABLED === "true"
				&& INR_WALLET_ACCOUNTING_READY,
			reason: !hasAdapterMethod(razorpayPayouts, "createPayout")
				? "Waiting for RazorpayX Payout account approval and payout adapter."
				: process.env.RAZORPAYX_PAYOUTS_ENABLED !== "true"
					? "Disabled until RazorpayX Payout onboarding is complete."
					: process.env.INR_WALLET_ENABLED !== "true"
						? "Disabled until the INR wallet and paise accounting are configured."
						: "Disabled until INR wallet accounting is implemented."
		}
	});

	const requireEnabled = (key, provider, method, label) => {
		if (!isEnabled(key, provider, method)) {
			throw new MerchantIntegrationError(`${label} is unavailable until its provider account is approved and configured.`);
		}
	};

	return {
		getCapabilities: capabilities,
		issueAmazonGiftCard: async (request) => {
			requireEnabled("AMAZON_AGCOD_ENABLED", amazonGiftCardIssuer, "issueGiftCard", "Amazon gift-card issuance");
			return amazonGiftCardIssuer.issueGiftCard(request);
		},
		issueMerchantVoucher: async (request) => {
			requireEnabled("MERCHANT_VOUCHERS_ENABLED", voucherIssuer, "issueVoucher", "Merchant voucher fulfillment");
			return voucherIssuer.issueVoucher(request);
		},
		createRazorpayCheckout: async (request) => {
			requireEnabled("RAZORPAY_CHECKOUT_ENABLED", razorpayCheckout, "createOrder", "Razorpay Checkout");
			if (process.env.INR_WALLET_ENABLED !== "true" || !INR_WALLET_ACCOUNTING_READY) {
				throw new MerchantIntegrationError("Razorpay Checkout is disabled until INR wallet accounting is configured.");
			}
			return razorpayCheckout.createOrder(request);
		},
		createRazorpayPayout: async (request) => {
			requireEnabled("RAZORPAYX_PAYOUTS_ENABLED", razorpayPayouts, "createPayout", "RazorpayX Payouts");
			if (process.env.INR_WALLET_ENABLED !== "true" || !INR_WALLET_ACCOUNTING_READY) {
				throw new MerchantIntegrationError("RazorpayX Payouts are disabled until INR wallet accounting is configured.");
			}
			return razorpayPayouts.createPayout(request);
		}
	};
};

module.exports = {
	MerchantIntegrationError,
	createMerchantIntegrations,
	merchantIntegrations: createMerchantIntegrations()
};
