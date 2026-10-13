const express = require("express");
const { receivePaymentEvent } = require("../controllers/webhookController");

const router = express.Router();

router.post("/payments", receivePaymentEvent);

module.exports = router;