const express = require("express");
const requireAuth = require("../middleware/authMiddleware");
const requireAdditionalVerification = require("../middleware/verificationMiddleware");
const {
	getWallet,
	getWalletSummary,
	getPayoutOptions,
	createCollection,
	createWithdrawal,
	getLedger
} = require("../controllers/walletController");

const router = express.Router();

router.use(requireAuth);
router.get("/", getWallet);
router.get("/summary", getWalletSummary);
router.get("/payout-options", getPayoutOptions);
router.get("/ledger", getLedger);
router.post("/collections", createCollection);
router.post("/withdrawals", requireAdditionalVerification, createWithdrawal);

module.exports = router;
