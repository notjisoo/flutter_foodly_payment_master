const express = require("express");
const bodyParser = require("body-parser");
const Stripe = require("stripe");

// 初始化 Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const dotenv = require("dotenv");

// 加载环境变量
dotenv.config();
const app = express();

// 使用 body-parser 中间件
app.use(bodyParser.json());
app.use(express.json()); // 确保 Vercel 能正确解析 JSON
app.use(bodyParser.raw({ type: "application/json" })); // 用于接收 Webhook 请求

// 创建支付意图的 API
app.post("/api/process-payment", async (req, res) => {
  try {
    // 接收来自前端的支付数据
    const { amount = 500, currency = "usd", paymentMethodId } = req.body;

    if (!amount || !currency || !paymentMethodId) {
      return res.status(400).json({ error: "Invalid parameters." });
    }

    // 创建支付意图
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethodId, // 前端传递的
      cardholder: "ich_1MsKAB2eZvKYlo2C3eZ2BdvK",
      type: "virtual",
      // confirm: true, // 直接确认支付（无需前端再次调用）
    });

    // 返回 client_secret
    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error processing payment:", error);
    res
      .status(500)
      .json({ error: "Payment processing failed", details: error.message });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    // 1.创建客户 - 可选
    if (
      !req.body.items ||
      !Array.isArray(req.body.items) ||
      req.body.items.length === 0
    ) {
      return res.status(400).json({ error: "Invalid or empty cartItems" });
    }

    const customer = await stripe.customers
      .create({
        metadata: {
          userId: req.body.userId,
          cart: JSON.stringify(req.body.cartItems),
        },
      })
      .catch((error) => {
        console.error("Error creating customer:", error);
        throw new Error("Failed to create customer");
      });

    // 2.格式化商品行项目
    const line_items = req.body.items.map((item) => {
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            description: item.description,
            metadata: {
              id: item.id,
            },
          },
          unit_amount: Math.round(item.price * 100), // 转换为美分
        },
        quantity: item.quantity,
      };
    });

    // 3.创建checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      line_items,
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    // 4.返回session URL给客户端
    res.send({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error.message,
    });
  }
});

app.get("/api/test", (req, res) => {
  res.send("Hello World");
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
