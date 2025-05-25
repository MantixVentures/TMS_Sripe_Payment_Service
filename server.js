require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Stripe = require("stripe");
const cors = require("cors");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

const OTHER_BACKEND_BASE = "https://tms-server-rosy.vercel.app/";

// Step 1: Create PaymentIntent
app.post("/create-payment-intent", async (req, res) => {
  const { civilNIC, fineId } = req.body;

  if (!civilNIC || !fineId) {
    return res.status(400).json({ error: "Missing civilNIC or fineId" });
  }

  try {
    // Fetch the fine
    const fineRes = await axios.get(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`);
    const fine = fineRes.data.data;

    // Verify ownership
    if (fine.civilNIC !== civilNIC) {
      return res.status(403).json({ error: "User not authorized to pay this fine" });
    }

    // Get fine amount
    const fineMgmtRes = await axios.get(`${OTHER_BACKEND_BASE}/fineManagement/${fine.fineManagementId}`);
    const amount = parseFloat(fineMgmtRes.data.data.fine) * 100; // USD cents

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      metadata: {
        fineId,
        civilNIC,
      },
    });

    res.status(200).send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("PaymentIntent creation error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Step 2: Confirm Payment (called from frontend after payment succeeds)
app.post("/confirm-payment", async (req, res) => {
  const { fineId, civilNIC } = req.body;

  if (!fineId || !civilNIC) {
    return res.status(400).json({ error: "Missing fineId or civilNIC" });
  }

  try {
    // Fetch the fine to validate again
    const fineRes = await axios.get(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`);
    const fine = fineRes.data.data;

    if (fine.civilNIC !== civilNIC) {
      return res.status(403).json({ error: "Unauthorized payment confirmation" });
    }

    // Mark fine as paid
    await axios.put(`${OTHER_BACKEND_BASE}/policeIssueFine/${fineId}`, {
      isPaid: true,
    });

    res.status(200).json({ message: "Fine marked as paid" });
  } catch (err) {
    console.error("Failed to confirm payment:", err.message);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

app.listen(3001, () => console.log("Server running on port 3001"));
