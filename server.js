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
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount,
      currency,
      payment_method: paymentMethodId, // 前端传递的 payment_method_id
      confirm: true, // 直接确认支付（无需前端再次调用）
    });

    // 返回支付结果
    res.status(200).json({ status: paymentIntent.status });
  } catch (error) {
    console.error("Error processing payment:", error);
    res
      .status(500)
      .json({ error: "Payment processing failed", details: error.message });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  // 创建客户
  if (!req.body.cartItems || !Array.isArray(req.body.cartItems)) {
    return res.status(400).json({ error: "Invalid cartItems format" });
  }

  const customer = await stripe.customers.create({
    metadata: {
      userId: req.body.userId,
      cart: JSON.stringify(req.body.cartItems),
    },
  });

  // 创建支付条目
  const line_items = req.body.cartItems.map((item) => {
    return {
      price_data: {
        currency: "usd",
        product_data: {
          name: item.name,
          description: "This is a test product",
          metadata: {
            id: item.id,
            restaurantId: item.restaurantId,
          },
        },
        unit_amount: item.price * 100,
      },
      quantity: item.quantity,
    };
  });

  try {
    // 创建支付会话
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      line_items,
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    // 返回session URL给客户端
    res.send({ url: session.url });
  } catch (error) {
    // 错误处理
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      error: "创建支付会话时发生错误",
    });
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
