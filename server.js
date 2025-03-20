const express = require("express");
const bodyParser = require("body-parser");
const stripe = require("stripe");
const dotenv = require("dotenv");

// 加载环境变量
dotenv.config();
const app = express();
const stripeInstance = stripe(process.env.STRIPE_SECRET_KEY);

// 使用 body-parser 中间件
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "application/json" })); // 用于接收 Webhook 请求

// ✅ 添加 test 路由
app.get("/api/test", (req, res) => {
  console.log("test");
  res.json({ message: "Hello from Express on Vercel!" });
});

// 创建支付意图的 API
app.post("/api/payment-intent", async (req, res) => {
  console.log("payment-intent");
  try {
    const { amount = 500, currency = "usd" } = req.body;

    if (!amount || !currency) {
      return res
        .status(400)
        .json({ error: "Amount and currency are required." });
    }

    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ["card"],
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 设置 Webhook 监听端点
app.post("/api/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripeInstance.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      console.log("支付成功：", event.data.object.id);
      break;

    case "payment_intent.payment_failed":
      console.log("支付失败：", event.data.object.id);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send("Webhook received");
});

// ✅ 让 Vercel 识别 `server.js` 作为 API 入口
module.exports = app;
