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
app.use(bodyParser.raw({ type: 'application/json' })); // 用于接收 Webhook 请求

// 创建支付意图的 API
app.post("/api/payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    // 检查请求数据
    if (!amount || !currency) {
      return res.status(400).json({ error: "Amount and currency are required." });
    }

    // 创建支付意图
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount, // 金额 (单位为最小单位，例如：美元是 "分")
      currency, // 货币类型，例如 "usd"
      payment_method_types: ["card"], // 支付方式
    });

    // 返回 client_secret 给前端
    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 设置 Webhook 监听端点
app.post("/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // 验证 Webhook 签名
    event = stripeInstance.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET // 在 Stripe 控制台中获取
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 根据事件类型处理逻辑
  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;
      console.log("支付成功：", paymentIntent.id);
      // 更新数据库中的订单状态
      break;

    case "payment_intent.payment_failed":
      const failedIntent = event.data.object;
      console.log("支付失败：", failedIntent.id);
      // 通知用户支付失败
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // 返回 200 响应，告知 Stripe 收到 Webhook
  res.status(200).send("Webhook received");
});


// 测试案例
// 测试案例：返回页面内容
app.get("/test", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Page</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin-top: 50px;
          }
          h1 {
            color: #4CAF50;
          }
        </style>
      </head>
      <body>
        <h1>This is Vercel Hello World!</h1>
        <p>API is working successfully on Vercel!</p>
      </body>
    </html>
  `);
});


// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


