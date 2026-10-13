const {
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	FIXED_PAYOUT_AMOUNT_CENTS,
	isValidAmountCents
} = require("./walletValidator");

const SUPPORTED_PAYOUT_METHODS = Object.freeze(["bank_transfer", "mobile_money"]);

const isValidPayoutMethod = (method) => typeof method === "string" && SUPPORTED_PAYOUT_METHODS.includes(method);

const isValidWithdrawalAmountCents = (amountCents) => (
	isValidAmountCents(amountCents)
	&& amountCents <= MAX_WITHDRAWAL_AMOUNT_CENTS
);

const isValidWithdrawalRequest = ({ amountCents, method }) => (
	isValidWithdrawalAmountCents(amountCents)
	&& isValidPayoutMethod(method)
);

module.exports = {
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	FIXED_PAYOUT_AMOUNT_CENTS,
	SUPPORTED_PAYOUT_METHODS,
	isValidPayoutMethod,
	isValidWithdrawalAmountCents,
	isValidWithdrawalRequest
};
