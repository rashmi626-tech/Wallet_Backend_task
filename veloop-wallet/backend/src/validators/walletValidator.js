const MAX_AMOUNT_CENTS = 1_000_000_000;
const MAX_WALLET_BALANCE_CENTS = Number(process.env.MAX_WALLET_BALANCE_CENTS || 500_000);
const MAX_WITHDRAWAL_AMOUNT_CENTS = Number(process.env.MAX_WITHDRAWAL_AMOUNT_CENTS || 250_000);
const FIXED_PAYOUT_AMOUNT_CENTS = Number(process.env.FIXED_PAYOUT_AMOUNT_CENTS || 50_000);

const isValidAmountCents = (amountCents) => (
	Number.isSafeInteger(amountCents)
	&& amountCents > 0
	&& amountCents <= MAX_AMOUNT_CENTS
);

const isValidCollectionAmountCents = (amountCents) => isValidAmountCents(amountCents);

const isValidWithdrawalAmountCents = (amountCents) => (
	isValidAmountCents(amountCents)
	&& amountCents <= MAX_WITHDRAWAL_AMOUNT_CENTS
);

const isWithinWalletLimit = (walletBalanceCents, amountCents) => (
	Number.isSafeInteger(walletBalanceCents)
	&& Number.isSafeInteger(amountCents)
	&& walletBalanceCents + amountCents <= MAX_WALLET_BALANCE_CENTS
);

const isValidIdempotencyKey = (key) => (
	typeof key === "string"
	&& /^[\w:.-]{8,100}$/.test(key)
);

module.exports = {
	MAX_AMOUNT_CENTS,
	MAX_WALLET_BALANCE_CENTS,
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	FIXED_PAYOUT_AMOUNT_CENTS,
	isValidAmountCents,
	isValidCollectionAmountCents,
	isValidWithdrawalAmountCents,
	isWithinWalletLimit,
	isValidIdempotencyKey
};
