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
app.use("/webhook", bodyParser.raw({ type: "application/json" })); // For Stripe webhooks only

const OTHER_BACKEND_BASE = "https://tms-server-rosy.vercel.app/";
const FASTFOREX_API_KEY = process.env.FASTFOREX_API_KEY;

// 1️⃣ Create Stripe Checkout session
app.post("/create-checkout-session", async (req, res) => {
  const { civilNIC, fineId } = req.body;

  if (!civilNIC || !fineId) {
    return res.status(400).json({ error: "Missing civilNIC or fineId" });
  }

  try {
    // Get fine
    const fineRes = await axios.get(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`);
    const fine = fineRes.data.data;

    if (fine.civilNIC !== civilNIC) {
      return res.status(403).json({ error: "Not authorized to pay this fine" });
    }

    // Get amount in LKR
    const fineMgmtRes = await axios.get(`${OTHER_BACKEND_BASE}/fine/${fine.fineManagementId}`);
    const lkrAmount = parseFloat(fineMgmtRes.data.data.fine);

    // Convert to USD using FastForex
    const fxRes = await axios.get(`https://api.fastforex.io/fetch-one?from=LKR&to=USD&api_key=${FASTFOREX_API_KEY}`);
    const rate = fxRes.data.result.USD;
    const usdAmount = (lkrAmount * rate).toFixed(2);
    const amountInCents = Math.round(usdAmount * 100);

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Traffic Fine Payment`,
              description: `Fine ID: ${fineId}`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: { fineId, civilNIC },
      success_url: "https://your-app.com/payment-success",
      cancel_url: "https://your-app.com/payment-cancelled",
    });

    res.status(200).json({
      message: "Checkout session created",
      checkoutUrl: session.url,
    });
  } catch (err) {
    console.error("Error creating checkout session:", err.message);
    res.status(500).json({ error: "Checkout session failed" });
  }
});

// 2️⃣ Stripe Webhook to mark fine as paid
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { fineId, civilNIC } = session.metadata;

    try {
      await axios.put(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`, {
        isPaid: true,
      });
      console.log(`✅ Fine ${fineId} marked as paid`);
    } catch (err) {
      console.error("Failed to update fine:", err.message);
    }
  }

  res.json({ received: true });
});

app.listen(3001, () => console.log("🚀 Server running on port 3001"));
