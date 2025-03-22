const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  paymentIntentId: {
    type: String,
    required: true,
    unique: true,
  },
  customerId: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    required: true,
    default: "usd",
  },
  status: {
    type: String,
    required: true,
    enum: ["succeeded", "failed", "pending"],
    default: "pending",
  },
  items: [
    {
      id: String,
      name: String,
      description: String,
      price: Number,
      quantity: Number,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    type: Map,
    of: String,
  },
});

module.exports = mongoose.model("Payment", paymentSchema);
