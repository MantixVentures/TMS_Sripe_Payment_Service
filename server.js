require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Stripe = require("stripe");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

const OTHER_BACKEND_BASE = "https://tms-server-rosy.vercel.app/";

// Create PaymentIntent
app.post("/create-payment-intent", async (req, res) => {
  const { civilNIC, fineId } = req.body;

  if (!civilNIC || !fineId) {
    return res.status(400).json({ error: "Missing userId or fineId" });
  }

  try {
    // Get fine data
    const fineRes = await axios.get(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`);
    const fine = fineRes.data.data;

    // Verify user owns the fine
    if (fine.civilNIC !== civilNIC) {
      return res.status(403).json({ error: "User not authorized to pay this fine" });
    }

    // Get amount from fineManagementId
    const fineMgmtRes = await axios.get(`${OTHER_BACKEND_BASE}/fineManagement/${fine.fineManagementId}`);
    const fineDetails = fineMgmtRes.data.data;
    const amount = parseFloat(fineDetails.fine) * 100; // convert to cents

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      metadata: {
        userId,
        fineId,
      },
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Error creating payment intent:", err);
    res.status(500).json({ error: "Payment intent creation failed" });
  }
});

// Webhook endpoint
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle successful payment
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const { fineId, userId } = paymentIntent.metadata;

    try {
      // Update fine status
      await axios.put(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`, {
        isPaid: true,
      });
      console.log(`Fine ${fineId} marked as paid.`);
    } catch (err) {
      console.error("Failed to update fine status:", err);
    }
  }

  res.json({ received: true });
});

app.listen(3001, () => console.log("Server running on port 3001"));
