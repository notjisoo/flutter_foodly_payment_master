const express = require("express");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
const Payment = require("./models/Payment"); // PaymentModel
const cors = require("cors");
// 加载环境变量
dotenv.config();

// 连接数据库
const uri = process.env.MONGODB_URI; // 替换为你的 MongoDB URI
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 20000,
});

try {
  await client.connect();
  console.log("Connected to MongoDB");
  return client;
} catch (error) {
  console.error("MongoDB connection error:", error);
}

app.use(
  cors({
    origin: "*", // 或者指定允许的域名
  })
);

// 排除webhook路由使用原始body
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/webhook")) {
    express.json()(req, res, next);
  } else {
    next();
  }
});

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
      payment_method_types: ["card"],
      type: "virtual",
      // confirm: true, // 直接确认支付（无需前端再次调用）
      // cardholder: "ich_1MsKAB2eZvKYlo2C3eZ2BdvK",
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
      !req.body.cartItems ||
      !Array.isArray(req.body.cartItems) ||
      req.body.cartItems.length === 0
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

    console.log(req.body.cartItems);

    // 2.格式化商品行项目
    const line_items = req.body.cartItems.map((item) => {
      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            description: item.description,
            metadata: {
              id: item.id,
            },
            images: [item.imageUrl],
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
app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      // 添加webhook接收日志
      console.log("收到Webhook事件:", event.type);
      console.log("Webhook事件数据:", event.data);

      switch (event.type) {
        // 支付意图成功
        case "payment_intent.succeeded":
          try {
            const paymentIntent = event.data.object;

            // 创建支付记录
            const payment = new Payment({
              paymentIntentId: paymentIntent.id,
              customerId: paymentIntent.customer,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: "succeeded",
              metadata: paymentIntent.metadata,
              items: JSON.parse(paymentIntent.metadata.items || "[]"), // 如果在metadata中存储了商品信息
            });

            // 保存到数据库
            await payment.save();

            console.log("支付记录已保存:", payment);
          } catch (error) {
            console.error("保存支付记录失败:", error);
          }
          break;

        // 支付意图失败
        case "payment_intent.payment_failed":
          try {
            const paymentIntent = event.data.object;

            // 创建失败的支付记录
            const payment = new Payment({
              paymentIntentId: paymentIntent.id,
              customerId: paymentIntent.customer,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: "failed",
              metadata: paymentIntent.metadata,
              items: JSON.parse(paymentIntent.metadata.items || "[]"),
            });

            await payment.save();

            console.log("失败的支付记录已保存:", payment);
          } catch (error) {
            console.error("保存失败支付记录错误:", error);
          }
          break;

        // 结账会话已完成
        case "checkout.session.completed":
          const checkoutData = event.data.object;
          const database = client.db("test");
          const ordersCollection = database.collection("orders");

          console.log("Session Completed");
          stripe.customers
            .retrieve(checkoutData.customer)
            .then(async (customer) => {
              try {
                const data = JSON.parse(customer.metadata.cart);

                const products = data.map((item) => {
                  return {
                    name: item.name,
                    id: item.id,
                    price: item.price,
                    quantity: item.quantity,
                    restaurantId: item.restaurantId,
                  };
                });

                console.log(products[0].id);

                const updateResult = await ordersCollection.findOneAndUpdate(
                  { _id: products[0].id }, // 使用正确的查询条件
                  {
                    $set: {
                      paymentStatus: "Completed",
                      orderStatus: "Placed",
                    },
                  },
                  { returnDocument: "after" } // 返回更新后的文档
                );

                if (updateResult.value) {
                  console.log("Order updated:", updateResult.value);
                } else {
                  console.log("Order not found");
                }
              } catch (error) {
                console.error("Error updating order:", error);
              }
            });
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }
      res.status(200).send("Webhook received");
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

module.exports = app;
