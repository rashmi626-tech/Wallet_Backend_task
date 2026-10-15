const express = require("express");
const requireAuth = require("../middleware/authMiddleware");
const requireAdditionalVerification = require("../middleware/verificationMiddleware");
const {
	getWallet,
	claimDailyStreak,
	addDemoFunds,
	withdrawDemoFunds,
	getDemoRewards,
	getIntegrationCapabilities,
	redeemDemoReward,
	getWalletSummary,
	getPayoutOptions,
	createCollection,
	createWithdrawal,
	getLedger
} = require("../controllers/walletController");

const router = express.Router();

router.use(requireAuth);
router.get("/", getWallet);
router.post("/daily-streak/claim", claimDailyStreak);
router.get("/rewards", getDemoRewards);
router.get("/integrations", getIntegrationCapabilities);
router.post("/rewards/:rewardId/redeem", redeemDemoReward);
router.post("/demo/payments", addDemoFunds);
router.post("/demo/withdrawals", withdrawDemoFunds);
router.get("/summary", getWalletSummary);
router.get("/payout-options", getPayoutOptions);
router.get("/ledger", getLedger);
router.post("/collections", createCollection);
router.post("/withdrawals", requireAdditionalVerification, createWithdrawal);

module.exports = router;
